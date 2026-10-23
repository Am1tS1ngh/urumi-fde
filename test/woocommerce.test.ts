import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { WooCommerceClient } from '../src/woocommerce.js';
import { createWooCommerceServer } from '../src/server.js';

// Synthetic credentials and data exist only in the test fixture, never as a
// runtime store fallback. No real WooCommerce installation is used here.
const token = 'test-only-adapter-token-0123456789abcdef';
const product = { id: 1, name: 'Test mug', price: '299.00', status: 'publish', permalink: 'https://store.example/product/test-mug' };

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function stop(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

async function fixture(t: TestContext, mode: 'success' | 'denied' | 'slow' | 'malformed' | 'redirect' | 'invalid-shape' = 'success') {
  const requests: { url: string; authorization: string | undefined }[] = [];
  const store = createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    if (mode === 'slow') return; // Intentionally never responds: timeout must stop the call.
    if (mode === 'denied') {
      res.writeHead(401).end('private upstream details: ck_test:cs_test');
    } else if (mode === 'redirect') {
      res.writeHead(302, { Location: '/redirect-target' }).end();
    } else if (mode === 'malformed') {
      res.writeHead(200).end('<html>not JSON</html>');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mode === 'invalid-shape' ? [{ name: 'missing fields' }] : [{ ...product, private_extra: 'must be stripped' }]));
    }
  });
  const storeUrl = await listen(store);
  t.after(() => stop(store));
  const adapter = await createWooCommerceServer(new WooCommerceClient({
    url: storeUrl,
    consumerKey: 'ck_test',
    consumerSecret: 'cs_test',
    allowHttp: true,
    timeoutMs: mode === 'slow' ? 100 : 2000,
  }), token);
  const adapterUrl = await listen(adapter.http);
  t.after(async () => { await adapter.close(); });
  const connect = async (modern = true) => {
    const client = new Client({ name: 'milestone-test', version: '1.0.0' }, modern ? { versionNegotiation: { mode: 'auto' } } : {});
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(`${adapterUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
  };
  return { requests, adapterUrl, connect };
}

test('discovers list_products and calls the WooCommerce REST path over HTTP', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  const listing = await client.listTools();
  assert.deepEqual(listing.tools.map(tool => tool.name), ['list_products', 'create_product', 'list_orders', 'get_order', 'update_order_status']);
  assert.equal(f.requests.length, 0, 'Discovery must not need store connectivity');
  const result = await client.callTool({ name: 'list_products', arguments: { page: 2, per_page: 5 } });
  assert.ok(!result.isError);
  assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify({ products: [product], page: 2, per_page: 5 }) }]);
  const request = f.requests[0];
  assert.ok(request);
  assert.equal(request.url, '/wp-json/wc/v3/products?page=2&per_page=5');
  assert.equal(request.authorization, `Basic ${Buffer.from('ck_test:cs_test').toString('base64')}`);
  assert.ok(!request.url.includes('ck_test'));
  assert.ok(!JSON.stringify(result).includes('private_extra'));
});

test('also supports the SDK legacy initialization flow', async t => {
  const f = await fixture(t);
  const client = await f.connect(false);
  assert.equal((await client.listTools()).tools[0]?.name, 'list_products');
  const result = await client.callTool({ name: 'list_products', arguments: {} });
  assert.ok(!result.isError);
  assert.equal(f.requests[0]?.url, '/wp-json/wc/v3/products?page=1&per_page=10');
});

test('rejects invalid pagination without calling the store', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  for (const args of [{ page: 0 }, { per_page: 101 }, { page: 1.5 }, { url: 'http://attacker.example' }]) {
    try {
      const result = await client.callTool({ name: 'list_products', arguments: args });
      assert.equal(result.isError, true);
    } catch (error) {
      // Either SDK client-side or server-side validation may reject the call.
      assert.match(String(error), /invalid|validation|schema|parameter|unrecognized/i);
    }
  }
  assert.equal(f.requests.length, 0);
});

for (const [mode, message] of [
  ['denied', 'WooCommerce denied access'],
  ['slow', 'WooCommerce request timed out'],
  ['malformed', 'WooCommerce returned invalid JSON'],
  ['redirect', 'Could not reach WooCommerce'],
  ['invalid-shape', 'WooCommerce returned an invalid response'],
] as const) {
  test(`returns a clear tool error for ${mode}, with no credentials in the result`, async t => {
    const f = await fixture(t, mode);
    const client = await f.connect();
    const result = await client.callTool({ name: 'list_products', arguments: {} });
    assert.equal(result.isError, true);
    const text = JSON.stringify(result);
    assert.ok(text.includes(message), text);
    assert.ok(!text.includes('ck_test'));
    assert.ok(!text.includes('cs_test'));
    assert.equal(f.requests.length, 1, 'No automatic retry or redirect');
    assert.equal((await client.listTools()).tools.length, 5);
  });
}

test('rejects missing/wrong MCP credentials and hostile browser origins', async t => {
  const f = await fixture(t);
  for (const authorization of ['', 'Bearer wrong']) {
    const response = await fetch(`${f.adapterUrl}/mcp`, { method: 'POST', headers: { Authorization: authorization } });
    assert.equal(response.status, 401);
  }
  const hostile = await fetch(`${f.adapterUrl}/mcp`, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, Origin: 'https://attacker.example',
  } });
  assert.equal(hostile.status, 403);
  // Use node:http: Node's fetch does not reliably honor an overridden Host.
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${f.adapterUrl}/mcp`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, Host: 'attacker.example',
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal(f.requests.length, 0);
  assert.equal((await fetch(`${f.adapterUrl}/healthz`)).status, 200);
  assert.equal((await fetch(`${f.adapterUrl}/unknown`)).status, 404);
});

test('configuration rejects accidental HTTP, embedded credentials, and invalid timeouts', async () => {
  const config = { url: 'https://store.example', consumerKey: 'ck_test', consumerSecret: 'cs_test' };
  assert.throws(() => new WooCommerceClient({ ...config, url: 'http://store.example' }), /HTTPS/);
  assert.throws(() => new WooCommerceClient({ ...config, url: 'https://user:password@store.example' }), /credentials/);
  assert.throws(() => new WooCommerceClient({ ...config, timeoutMs: 0 }), /timeout/);
  await assert.rejects(() => createWooCommerceServer(new WooCommerceClient(config), 'short'), /MCP_UPSTREAM_TOKEN/);
});


test('in-cluster settings: extra allowed host and forwarded proto header', async t => {
  const seen: (string | string[] | undefined)[] = [];
  const store = createServer((req, res) => {
    seen.push(req.headers['x-forwarded-proto']);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([product]));
  });
  const storeUrl = await listen(store);
  t.after(() => stop(store));
  const serviceHost = 'woo-mcp.urumi-platform.svc.cluster.local';
  const adapter = await createWooCommerceServer(new WooCommerceClient({
    url: storeUrl, consumerKey: 'ck_test', consumerSecret: 'cs_test', allowHttp: true, forwardedProto: 'https',
  }), token, [serviceHost]);
  const adapterUrl = await listen(adapter.http);
  t.after(async () => { await adapter.close(); });

  const statusFor = (host: string) => new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${adapterUrl}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: host } },
      response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  assert.notEqual(await statusFor(`${serviceHost}:3001`), 403);
  assert.equal(await statusFor('other.svc.cluster.local'), 403);

  const client = new Client({ name: 'cluster-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${adapterUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  assert.ok(!(await client.callTool({ name: 'list_products', arguments: {} })).isError);
  assert.deepEqual(seen, ['https']);
});

test('forwardedProto only accepts https', () => {
  assert.throws(() => new WooCommerceClient({
    url: 'https://store.example', consumerKey: 'ck_test', consumerSecret: 'cs_test', forwardedProto: 'http' as 'https',
  }), /forwardedProto/);
});
