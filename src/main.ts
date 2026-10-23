import { createWooCommerceServer } from './server.js';
import { WooCommerceClient } from './woocommerce.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

try {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  // Loopback by default. The cluster sets HOST=0.0.0.0 and relies on NetworkPolicy.
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const forwardedProto = process.env.WOOCOMMERCE_FORWARDED_PROTO?.trim();
  if (forwardedProto && forwardedProto !== 'https') throw new Error('WOOCOMMERCE_FORWARDED_PROTO may only be https.');
  const store = new WooCommerceClient({
    url: required('WOOCOMMERCE_URL'),
    consumerKey: required('WOOCOMMERCE_CONSUMER_KEY'),
    consumerSecret: required('WOOCOMMERCE_CONSUMER_SECRET'),
    allowHttp: process.env.WOOCOMMERCE_ALLOW_HTTP === 'true',
    forwardedProto: forwardedProto ? 'https' : undefined,
  });
  const app = await createWooCommerceServer(store, required('MCP_UPSTREAM_TOKEN'), list('MCP_ALLOWED_HOSTS'));
  await app.app.listen(port, host); console.log(`WooCommerce MCP listening at http://${host}:${port}/mcp`);
  app.http.on('error', () => {
    console.error('Could not start HTTP server. Check whether PORT is already in use.');
    process.exitCode = 1;
  });
  const shutdown = async () => {

    await app.close();
    app.http.closeAllConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  // Constructor errors are controlled configuration messages, never raw URLs.
  console.error(error instanceof TypeError ? 'Invalid server configuration; check the store URL.' : (error as Error).message);
  process.exitCode = 1;
}
