import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createUtilsServer } from './app.mjs';

const apiKey = 'test-utils-key-0123456789';

async function start(t) {
  const server = createUtilsServer(apiKey);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('rejects requests without the API key', async t => {
  const url = await start(t);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});

test('lists and runs tools with the API key', async t => {
  const url = await start(t);
  const client = new Client({ name: 'utils-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { 'X-Api-Key': apiKey } } }));
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['convert_currency', 'current_time', 'echo', 'sleep']);
  const result = await client.callTool({ name: 'convert_currency', arguments: { amount: 880, from: 'INR', to: 'EUR' } });
  assert.equal(JSON.parse(result.content[0].text).converted, 8.6);
});
