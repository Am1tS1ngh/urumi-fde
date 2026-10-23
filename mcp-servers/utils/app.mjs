import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

// Fixed demo rates, in units per US dollar. Not live market data.
const RATES = { USD: 1, INR: 88, EUR: 0.86, GBP: 0.75 };
const currency = z.enum(Object.keys(RATES));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failure = message => ({ isError: true, content: [{ type: 'text', text: message }] });

function buildServer() {
  const server = new McpServer({ name: 'urumi-utils', version: '0.1.0' });
  server.registerTool('convert_currency', {
    description: 'Convert an amount between INR, USD, EUR and GBP using fixed demo rates (not live data).',
    inputSchema: z.strictObject({ amount: z.number().nonnegative(), from: currency, to: currency }),
    annotations: readOnly,
  }, ({ amount, from, to }) => text({
    amount, from, to, converted: Math.round((amount / RATES[from]) * RATES[to] * 100) / 100, rates: 'fixed demo rates',
  }));
  server.registerTool('current_time', {
    description: 'Current date and time in an IANA time zone such as Asia/Kolkata.',
    inputSchema: z.strictObject({ timezone: z.string().max(64).default('UTC') }),
    annotations: readOnly,
  }, ({ timezone }) => {
    try {
      const local = new Date().toLocaleString('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' });
      return text({ timezone, local, utc: new Date().toISOString() });
    } catch {
      return failure(`Unknown time zone "${timezone}".`);
    }
  });
  server.registerTool('echo', {
    description: 'Echo text back. Shares its name with the reference server\'s echo tool.',
    inputSchema: z.strictObject({ text: z.string().max(2000) }),
    annotations: readOnly,
  }, ({ text: value }) => text({ echo: value, from: 'utils' }));
  server.registerTool('sleep', {
    description: 'Wait for 0-60 seconds before answering. Useful to see gateway timeouts.',
    inputSchema: z.strictObject({ seconds: z.number().int().min(0).max(60) }),
    annotations: readOnly,
  }, async ({ seconds }) => {
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return text({ slept: seconds });
  });
  return server;
}

/** An HTTP server for the utils tools. Every /mcp request needs the X-Api-Key header. */
export function createUtilsServer(apiKey) {
  if (!apiKey || apiKey.length < 16) throw new Error('UTILS_MCP_API_KEY must be at least 16 characters.');
  const expected = Buffer.from(apiKey);
  const handler = createMcpHandler(() => buildServer());
  const handle = toNodeHandler(handler);

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
    if (path !== '/mcp') return void res.writeHead(404).end();
    const actual = Buffer.from(String(req.headers['x-api-key'] ?? ''));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return void res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"Unauthorized"}');
    }
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });
  server.on('close', () => void handler.close());
  return server;
}
