import { Inject, Injectable } from '@nestjs/common';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { CONFIG, type AppConfig } from '../config.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService, type AuditSource } from '../audit/audit.service.js';
import { UpstreamsService } from '../upstreams/upstreams.service.js';
import { UpstreamStatusService } from '../upstreams/upstream-status.service.js';
import { UpstreamClients } from '../upstreams/upstream-clients.js';
import { describeUpstreamError } from '../upstreams/upstream-errors.js';
import { exposedName, parseExposedName } from '../upstreams/tool-names.js';

export interface GatewayTool {
  name: string;
  upstreamName: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  annotations?: Tool['annotations'];
}

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

export function resultText(result: CallToolResult): string {
  return (result.content ?? []).map(block => block.type === 'text' ? block.text : `[${block.type} content]`).join('\n');
}

/** The single path every tool call takes, whether it comes from /mcp or from chat. */
@Injectable()
export class ToolRouter {
  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamStatusService) private readonly status: UpstreamStatusService,
    @Inject(UpstreamClients) private readonly clients: UpstreamClients,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Tools from every enabled upstream that is reachable right now. */
  async listTools(): Promise<GatewayTool[]> {
    const snapshots = await Promise.all((await this.upstreams.listEnabled()).map(upstream => this.status.current(upstream)));
    return snapshots.flatMap(snapshot => snapshot.state !== 'connected' ? [] : snapshot.tools.map(tool => ({
      name: exposedName(snapshot.upstream.slug, tool.name),
      upstreamName: snapshot.upstream.name,
      // Tagging the source tells the model, and people, which server wrote the text.
      description: `[${snapshot.upstream.name}] ${(tool.description ?? '').slice(0, 1024)}`,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })));
  }

  async callTool(user: AuthUser, name: string, args: Record<string, unknown>, source: AuditSource): Promise<CallToolResult> {
    const started = Date.now();
    const parsed = parseExposedName(name);
    const upstream = parsed ? await this.upstreams.findBySlug(parsed.slug) : null;

    if (!parsed || !upstream?.enabled) {
      const detail = upstream ? `${upstream.name} is disabled.` : `Unknown tool "${name}". Tool names look like <server>__<tool>.`;
      await this.audit.record({
        user, source, toolName: name, durationMs: Date.now() - started, outcome: 'denied', detail,
        upstream: upstream ? { id: upstream.id, name: upstream.name } : null,
      });
      return errorResult(detail);
    }

    const ref = { id: upstream.id, name: upstream.name };
    try {
      const result = await this.clients.callTool(upstream, parsed.tool, args);
      await this.audit.record({
        user, source, upstream: ref, toolName: name, durationMs: Date.now() - started,
        outcome: result.isError ? 'error' : 'success', detail: result.isError ? resultText(result) : null,
      });
      return result;
    } catch (error) {
      const detail = describeUpstreamError(upstream.name, error, this.config.callTimeoutMs);
      // Update the dashboard status now instead of waiting for the next health check.
      void this.status.refresh(upstream);
      await this.audit.record({ user, source, upstream: ref, toolName: name, durationMs: Date.now() - started, outcome: 'error', detail });
      return errorResult(detail);
    }
  }
}
