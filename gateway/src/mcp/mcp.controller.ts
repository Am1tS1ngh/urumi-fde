import { All, Controller, Inject, Req, Res, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createMcpHandler, Server, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { KeysService } from '../keys/keys.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ToolRouter } from '../router/tool-router.service.js';
import { bearerToken, type AuthUser } from '../auth/auth.types.js';

function calledTool(body: unknown): string | null {
  const message = body as { method?: unknown; params?: { name?: unknown } } | null;
  return message?.method === 'tools/call' && typeof message.params?.name === 'string' ? message.params.name : null;
}

@Controller('mcp')
export class McpController implements OnModuleDestroy {
  private readonly handler;
  private readonly handle;

  constructor(
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ToolRouter) private readonly router: ToolRouter,
  ) {
    // A fresh, stateless server per request, so any replica can answer any call.
    this.handler = createMcpHandler(context => this.serverFor(context.authInfo?.extra?.user as AuthUser));
    this.handle = toNodeHandler(this.handler);
  }

  @All()
  async serve(@Req() req: Request & { auth?: AuthInfo }, @Res() res: Response): Promise<void> {
    const key = await this.keys.check(bearerToken(req));
    if (key.kind !== 'ok') {
      const tool = calledTool(req.body);
      if (key.kind === 'revoked' && tool) {
        await this.audit.record({ user: key.user, source: 'mcp', upstream: null, toolName: tool, durationMs: 0, outcome: 'denied', detail: 'API key revoked or user disabled.' });
      }
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: key.kind === 'revoked' ? 'This API key has been revoked.' : 'Missing or invalid API key.' },
        id: (req.body as { id?: unknown } | undefined)?.id ?? null,
      });
      return;
    }
    req.auth = { token: 'gateway-key', clientId: key.user.id, scopes: [], extra: { user: key.user } };
    await this.handle(req, res, req.body);
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close();
  }

  private serverFor(user: AuthUser): Server {
    const server = new Server(
      { name: 'urumi-gateway', version: '0.1.0' },
      { capabilities: { tools: {} }, instructions: 'Tools are named <server>__<tool>. Every call runs as your user and is audited.' },
    );
    server.setRequestHandler('tools/list', async () => ({
      tools: (await this.router.listTools()).map(({ name, description, inputSchema, annotations }) => ({
        name, description, inputSchema, ...(annotations ? { annotations } : {}),
      })),
    }));
    server.setRequestHandler('tools/call', request =>
      this.router.callTool(user, request.params.name, request.params.arguments ?? {}, 'mcp'));
    return server;
  }
}
