import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createWooCommerceServer } from '../src/server.js';
import { WooCommerceClient } from '../src/woocommerce.js';
import type { OrderSummary } from '../src/tools/schemas.js';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env.`);
  return value;
}
async function main() {
  const token = required('MCP_UPSTREAM_TOKEN');
  const store = new WooCommerceClient({
    url: required('WOOCOMMERCE_URL'), consumerKey: required('WOOCOMMERCE_CONSUMER_KEY'),
    consumerSecret: required('WOOCOMMERCE_CONSUMER_SECRET'),
  });
  const adapter = await createWooCommerceServer(store, token);
  const client = new Client({ name: 'real-store-smoke', version: '2.0.0' }, { versionNegotiation: { mode: 'auto' } });
  const evidence: Record<string, unknown> = { checked_at: new Date().toISOString(), transport: 'Streamable HTTP', framework: 'NestJS', writes_enabled: process.env.SMOKE_WRITE_CHECKS === '1' };
  try {
    await adapter.app.listen(0, '127.0.0.1');
    const address = adapter.http.address(); assert.ok(address && typeof address !== 'string');
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
    const rejected = await fetch(endpoint, { method: 'POST' });
    assert.equal(rejected.status, 401); await rejected.body?.cancel();
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const tools = (await client.listTools()).tools.map(t => t.name);
    assert.deepEqual(tools, ['list_products', 'create_product', 'list_orders', 'get_order', 'update_order_status']);
    evidence.tools = tools;
    async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content?.find(c => c.type === 'text'); assert.ok(text?.type === 'text');
      if (result.isError) throw new Error(text.text);
      return JSON.parse(text.text) as T;
    }
    const products = await call<{ products: { id: number; name: string; price: string; permalink: string }[] }>('list_products', { per_page: 100 });
    const original = products.products.find(p => p.name === (process.env.SMOKE_PRODUCT_NAME ?? 'First Product'));
    assert.ok(original, 'Original demo product must exist.');
    assert.equal(Number(original.price), Number(process.env.SMOKE_PRODUCT_PRICE ?? '199'));
    const orderId = Number(process.env.SMOKE_ORDER_ID ?? 14);
    const originalOrder = (await call<{ order: OrderSummary }>('get_order', { order_id: orderId })).order;
    assert.equal(originalOrder.id, orderId);
    assert.ok(!('billing' in originalOrder) && !('order_key' in originalOrder));
    assert.ok(originalOrder.date_created_gmt);
    const instant = Date.parse(originalOrder.date_created_gmt + 'Z');
    const iso = (n: number) => new Date(n).toISOString().replace('.000Z', 'Z');
    const containing = await call<{ orders: OrderSummary[]; total: number | null }>('list_orders', { after: iso(instant - 60_000), before: iso(instant + 60_000), per_page: 100 });
    assert.ok(containing.orders.some(o => o.id === orderId), 'GMT range must contain original order.');
    const excluding = await call<{ orders: OrderSummary[] }>('list_orders', { after: iso(instant + 86_400_000), before: iso(instant + 172_800_000), per_page: 100 });
    assert.ok(!excluding.orders.some(o => o.id === orderId), 'Different day must exclude original order.');
    evidence.original_product_id = original.id;
    evidence.original_order = { id: originalOrder.id, status: originalOrder.status, total: originalOrder.total };
    evidence.date_filter_checks = 'containing range included order; following day excluded order';
    if (process.env.SMOKE_WRITE_CHECKS === '1') {
      const sku = `MCP-DEMO-${Date.now()}`;
      const created = (await call<{ product: { id: number; name: string; price: string; status: string; permalink: string } }>('create_product', {
        name: `MCP Verification Mug ${sku}`, regular_price: '49.00', description: 'Synthetic product for the five tool verification milestone.', sku,
      })).product;
      assert.equal(created.status, 'publish'); assert.equal(Number(created.price), 49);
      console.log(`Created labelled demo product #${created.id}; do not retry creation blindly if a later check fails.`);
      evidence.created_product = { id: created.id, sku, name: created.name, price: created.price };
      // Test arrangement only. create_order is NOT an exposed MCP tool.
      const url = new URL('/wp-json/wc/v3/orders', required('WOOCOMMERCE_URL'));
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Basic ${Buffer.from(required('WOOCOMMERCE_CONSUMER_KEY') + ':' + required('WOOCOMMERCE_CONSUMER_SECRET')).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'on-hold', payment_method: 'cod', payment_method_title: 'Cash on delivery', set_paid: false, customer_note: `Synthetic MCP verification ${sku}`, line_items: [{ product_id: created.id, quantity: 1 }] }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Demo order arrangement returned HTTP ${response.status}; inspect store before retrying.`); }
      const arranged = await response.json() as { id: number }; assert.ok(Number.isSafeInteger(arranged.id));
      console.log(`Created separate demo order #${arranged.id}; original #${orderId} is read only.`);
      const before = (await call<{ order: OrderSummary }>('get_order', { order_id: arranged.id })).order;
      assert.equal(before.status, 'on-hold');
      const changed = (await call<{ order: OrderSummary }>('update_order_status', { order_id: arranged.id, status: 'processing' })).order;
      assert.equal(changed.status, 'processing');
      const persisted = (await call<{ order: OrderSummary }>('get_order', { order_id: arranged.id })).order;
      assert.equal(persisted.status, 'processing');
      const published = await call<{ products: { id: number }[] }>('list_products', { per_page: 100 });
      assert.ok(published.products.some(p => p.id === created.id));
      const listed = await call<{ orders: OrderSummary[] }>('list_orders', { status: 'processing', per_page: 100 });
      assert.ok(listed.orders.some(o => o.id === arranged.id));
      const untouched = (await call<{ order: OrderSummary }>('get_order', { order_id: orderId })).order;
      assert.equal(untouched.status, originalOrder.status);
      evidence.created_order = { id: arranged.id, before: before.status, after: persisted.status, total: persisted.total };
      evidence.original_order_unchanged = true;
    }
    evidence.result = 'PASS';
    await writeFile('.local/five-tools-verification.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await client.close(); await adapter.close(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Live verification failed.');
  process.exitCode = 1;
});
