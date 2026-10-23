import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createWooCommerceServer } from '../src/server.js';
import { WooCommerceClient } from '../src/woocommerce.js';

const token = 'fixture-token-for-five-tools-0123456789';
const product = { id: 21, name: 'Demo mug', price: '199', status: 'publish', permalink: 'https://store.example/mug' };
const order = { id: 14, number: '14', status: 'processing', currency: 'INR', total: '199.00', date_created: '2026-10-21T13:00:00', date_created_gmt: '2026-10-21T13:00:00', line_items: [{ id: 1, product_id: 21, name: 'Demo mug', quantity: 1, total: '199.00', meta_data: ['private'] }], billing: { email: 'private@example.test' }, order_key: 'private-order-key' };
async function fixture(t: TestContext, mode = 'success') {
  const requests: { url: string; method: string; body: unknown }[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const body = text ? JSON.parse(text) : undefined;
    requests.push({ url: req.url!, method: req.method!, body });
    if (mode === 'slow-body') { res.writeHead(200); res.write('{'); return; }
    if (/^http-/.test(mode)) { res.writeHead(Number(mode.slice(5))).end('ck_fixture secret private'); return; }
    if (mode === 'oversize') { res.end('x'.repeat(2_000_001)); return; }
    if (mode === 'malformed') { res.end('not JSON'); return; }
    if (mode !== 'no-headers') res.setHeader('X-WP-Total', '2').setHeader('X-WP-TotalPages', '1');
    if (req.url?.startsWith('/wp-json/wc/v3/products')) res.end(JSON.stringify(product));
    else if (req.url?.startsWith('/wp-json/wc/v3/orders/')) res.end(JSON.stringify({ ...order, ...(body ?? {}) }));
    else res.end(JSON.stringify([order]));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const adapter = await createWooCommerceServer(new WooCommerceClient({ url: `http://127.0.0.1:${address.port}`, consumerKey: 'ck_fixture', consumerSecret: 'cs_fixture', allowHttp: true, timeoutMs: mode === 'slow-body' ? 100 : 2000 }), token);
  await adapter.app.listen(0, '127.0.0.1');
  const addr = adapter.http.address(); assert.ok(addr && typeof addr !== 'string');
  const client = new Client({ name: 'five-tools-test', version: '1' }, { versionNegotiation: { mode: 'auto' } });
  t.after(async () => { await client.close(); await adapter.close(); upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r())); });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${addr.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  return { call, requests };
}
function data(result: Awaited<ReturnType<Client['callTool']>>) {
  assert.ok(!result.isError, JSON.stringify(result));
  const item = result.content?.find(c => c.type === 'text'); assert.ok(item?.type === 'text');
  return JSON.parse(item.text);
}

test('get_order returns only selected fields including selected line item fields', async t => {
  const f = await fixture(t);
  const result = data(await f.call('get_order', { order_id: 14 }));
  assert.equal(result.order.id, 14);
  assert.equal(f.requests[0]?.url, '/wp-json/wc/v3/orders/14');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(Object.keys(result.order.line_items[0]), ['id', 'product_id', 'name', 'quantity', 'total']);
});
test('list_orders normalizes timezone filters and reports actual pagination headers', async t => {
  const f = await fixture(t);
  const result = data(await f.call('list_orders', { page: 2, per_page: 2, status: 'processing', after: '2026-10-21T00:00:00+05:30', before: '2026-10-22T00:00:00+05:30' }));
  const url = new URL(f.requests[0]!.url, 'http://fixture');
  assert.equal(url.searchParams.get('after'), '2026-10-20T18:30:00');
  assert.equal(url.searchParams.get('before'), '2026-10-21T18:30:00');
  assert.equal(url.searchParams.get('dates_are_gmt'), 'true');
  assert.equal(url.searchParams.get('status'), 'processing');
  assert.equal(result.total, 2); assert.equal(result.total_pages, 1); assert.equal(result.page, 2);
});
test('missing total headers remain unknown rather than invented', async t => {
  const f = await fixture(t, 'no-headers');
  const result = data(await f.call('list_orders', {}));
  assert.equal(result.total, null); assert.equal(result.total_pages, null);
});
test('create_product sends a simple product with decimal string price', async t => {
  const f = await fixture(t);
  assert.equal(data(await f.call('create_product', { name: ' Demo mug ', regular_price: '199.00', sku: 'DEMO-1' })).product.id, 21);
  assert.deepEqual(f.requests[0], { url: '/wp-json/wc/v3/products', method: 'POST', body: { name: 'Demo mug', regular_price: '199.00', sku: 'DEMO-1', status: 'publish', type: 'simple' } });
});
test('update_order_status uses PUT with only the status field', async t => {
  const f = await fixture(t);
  for (const status of ['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'failed']) {
    assert.equal(data(await f.call('update_order_status', { order_id: 14, status })).order.status, status);
    assert.deepEqual(f.requests.at(-1), { url: '/wp-json/wc/v3/orders/14', method: 'PUT', body: { status } });
  }
});
test('all tools reject dangerous or invalid arguments before any store request', async t => {
  const f = await fixture(t);
  const cases: [string, Record<string, unknown>][] = [
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '14'].map(id => ['get_order', { order_id: id }] as [string, Record<string, unknown>]),
    ['list_orders', { status: 'invented' }], ['list_orders', { after: '2026-10-21T00:00:00' }],
    ['list_orders', { after: '2026-10-22T00:00:00Z', before: '2026-10-21T00:00:00Z' }],
    ['list_orders', { per_page: 101 }], ['get_order', { order_id: 14, url: 'http://evil' }],
    ...['refunded', 'trash', 'invented'].map(status => ['update_order_status', { order_id: 14, status }] as [string, Record<string, unknown>]),
    ['update_order_status', { order_id: 14, status: 'processing', billing: {} }],
    ...[-1, '1.234', '-5', '1e5', ''].map(price => ['create_product', { name: 'Mug', regular_price: price }] as [string, Record<string, unknown>]),
    ['create_product', { name: ' ', regular_price: '1' }], ['create_product', { name: 'Mug', regular_price: '1', url: 'http://evil' }],
  ];
  for (const [name, args] of cases) {
    try { assert.equal((await f.call(name, args)).isError, true, name); }
    catch (error) { assert.match(String(error), /invalid|validation|schema|parameter|unrecognized/i); }
  }
  assert.equal(f.requests.length, 0);
});
for (const status of [400, 401, 403, 404, 429, 500]) test(`safe HTTP ${status} failure without raw store body or automatic retry`, async t => {
  const f = await fixture(t, `http-${status}`);
  const result = await f.call('create_product', { name: 'Demo', regular_price: '1' });
  assert.equal(result.isError, true);
  const text = JSON.stringify(result);
  assert.ok(!text.includes('ck_fixture')); assert.ok(!text.includes('private'));
  if (status === 500) assert.match(text, /outcome may be unknown/);
  assert.equal(f.requests.length, 1);
});
for (const [mode, expected] of [['slow-body', 'timed out'], ['oversize', '2 MB'], ['malformed', 'invalid JSON']]) test(`write ${mode} is bounded and explicitly ambiguous`, async t => {
  const f = await fixture(t, mode);
  const result = await f.call('create_product', { name: 'Demo', regular_price: '1' });
  assert.equal(result.isError, true);
  assert.ok(JSON.stringify(result).includes(expected!));
  assert.match(JSON.stringify(result), /outcome may be unknown/);
  assert.equal(f.requests.length, 1);
});
