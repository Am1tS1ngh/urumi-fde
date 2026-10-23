import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from '@modelcontextprotocol/client';
import { CONFIG, type AppConfig } from '../config.js';
import { assertSafeUpstreamUrl } from './ssrf.js';
import { UpstreamsService, type Upstream } from './upstreams.service.js';

const MAX_TOOLS = 500;

interface Entry {
  version: number;
  client: Promise<Client>;
}

/**
 * One MCP client per upstream. A client is rebuilt when the upstream is edited
 * and dropped after any failure, so a restarted server is picked up again.
 */
@Injectable()
export class UpstreamClients implements OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();

  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async listTools(upstream: Upstream): Promise<Tool[]> {
    return this.withClient(upstream, async client => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.config.listTimeoutMs });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor && tools.length < MAX_TOOLS);
      return tools.slice(0, MAX_TOOLS);
    });
  }

  callTool(upstream: Upstream, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.withClient(upstream, client => client.callTool({ name, arguments: args }, { timeout: this.config.callTimeoutMs }));
  }

  drop(upstreamId: string): void {
    const entry = this.entries.get(upstreamId);
    if (!entry) return;
    this.entries.delete(upstreamId);
    void entry.client.then(client => client.close()).catch(() => undefined);
  }

  onModuleDestroy(): void {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  private async withClient<T>(upstream: Upstream, use: (client: Client) => Promise<T>): Promise<T> {
    try {
      return await use(await this.clientFor(upstream));
    } catch (error) {
      this.drop(upstream.id);
      throw error;
    }
  }

  private clientFor(upstream: Upstream): Promise<Client> {
    const version = upstream.updatedAt.getTime();
    const existing = this.entries.get(upstream.id);
    if (existing?.version === version) return existing.client;
    if (existing) this.drop(upstream.id);
    // Concurrent callers share one pending connection instead of each opening their own.
    const client = this.connect(upstream);
    this.entries.set(upstream.id, { version, client });
    return client;
  }

  private async connect(upstream: Upstream): Promise<Client> {
    // Checked again here because DNS can change after the URL was saved.
    await assertSafeUpstreamUrl(upstream.url, this.config);
    const transport = new StreamableHTTPClientTransport(new URL(upstream.url), {
      requestInit: { headers: this.upstreams.authHeaders(upstream), redirect: 'error' },
    });
    const client = new Client({ name: 'urumi-gateway', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
    await client.connect(transport, { timeout: this.config.listTimeoutMs });
    return client;
  }
}
