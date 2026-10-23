import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WooCommerceModule } from './woocommerce.module.js';
import { McpService } from './mcp/mcp.service.js';
import { WooCommerceClient } from './woocommerce.js';

export async function createWooCommerceServer(store: WooCommerceClient, token: string) {
  if (token.length < 32 || /\s/.test(token)) throw new Error('MCP_UPSTREAM_TOKEN must be at least 32 characters and contain no whitespace.');
  // The SDK reads the stream itself; an Express body parser would consume it.
  const app = await NestFactory.create(WooCommerceModule.register(store, token), {
    bodyParser: false, logger: false, abortOnError: false,
  });
  app.use(app.get(McpService).middleware);
  await app.init();
  const http = app.getHttpServer() as import('node:http').Server;
  return { app, http, close: async () => { http.closeAllConnections(); await app.close(); } };
}
