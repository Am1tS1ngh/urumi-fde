import * as z from 'zod/v4';
import { listProductsInput, getOrderInput, listOrdersInput, createProductInput, updateOrderStatusInput, productSchema, orderSchema } from './tools/schemas.js';
export { listProductsInput } from './tools/schemas.js';

export interface WooCommerceConfig {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  allowHttp?: boolean;
  timeoutMs?: number;
}

// Only these controlled messages may cross the MCP boundary. Never relay a raw
// store response or fetch error: either could contain credentials or internals.
export class StoreError extends Error {}

export class WooCommerceClient {
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly timeoutMs: number;

  constructor(config: WooCommerceConfig) {
    const url = new URL(config.url);
    if (url.protocol !== 'https:' && !(config.allowHttp && url.protocol === 'http:')) {
      throw new Error('WooCommerce requires HTTPS; local HTTP requires explicit opt-in.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('Store URL must not contain credentials, a query, or a fragment.');
    }
    if (!config.consumerKey || !config.consumerSecret || config.consumerKey.includes(':')) {
      throw new Error('Valid WooCommerce credentials are required.');
    }
    this.timeoutMs = config.timeoutMs ?? 5_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new Error('Store timeout must be an integer from 1 to 60000 ms.');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/wp-json/wc/v3/`;
    this.baseUrl = url;
    this.authorization = `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')}`;
  }

  async listProducts(input: z.input<typeof listProductsInput> = {}) {
    const { page, per_page } = listProductsInput.parse(input);
    const result = await this.request('products', z.array(productSchema), { query: { page, per_page } });
    return { products: result.data, page, per_page };
  }

  async getOrder(input: z.input<typeof getOrderInput>) {
    const { order_id } = getOrderInput.parse(input);
    return { order: (await this.request(`orders/${order_id}`, orderSchema)).data };
  }

  async listOrders(input: z.input<typeof listOrdersInput> = {}) {
    const { page, per_page, status, after, before } = listOrdersInput.parse(input);
    const query: Record<string, string | number> = { page, per_page };
    if (status) query.status = status;
    // Convert input instants to UTC, then send a GMT wall-clock value with the flag.
    // A trailing Z makes WP_Date_Query convert to site time even on a GMT column
    // in this WooCommerce installation. Live checks cover a non-UTC store timezone.
    if (after || before) query.dates_are_gmt = 'true';
    if (after) query.after = new Date(after).toISOString().replace('.000Z', '');
    if (before) query.before = new Date(before).toISOString().replace('.000Z', '');
    const result = await this.request('orders', z.array(orderSchema), { query });
    return { orders: result.data, page, per_page, total: result.total, total_pages: result.totalPages };
  }

  async createProduct(input: z.input<typeof createProductInput>) {
    const body = createProductInput.parse(input);
    return { product: (await this.request('products', productSchema, { method: 'POST', body: { ...body, type: 'simple' } })).data };
  }

  async updateOrderStatus(input: z.input<typeof updateOrderStatusInput>) {
    const { order_id, status } = updateOrderStatusInput.parse(input);
    return { order: (await this.request(`orders/${order_id}`, orderSchema, { method: 'PUT', body: { status } })).data };
  }

  private async request<T>(path: string, schema: z.ZodType<T>, options: {
    method?: 'GET' | 'POST' | 'PUT'; query?: Record<string, string | number>; body?: unknown;
  } = {}) {
    const method = options.method ?? 'GET';
    const write = method !== 'GET';
    const uncertain = write ? ' Write outcome may be unknown; inspect the store before retrying.' : '';
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: { Authorization: this.authorization, Accept: 'application/json', ...(write ? { 'Content-Type': 'application/json' } : {}) },
        body: write ? JSON.stringify(options.body) : undefined,
        signal,
        // A redirect must never forward store credentials to another host.
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) {
          throw new StoreError('WooCommerce denied access; check the server-side store credentials and permissions.');
        }
        if (response.status === 404) throw new StoreError('WooCommerce resource was not found.');
        throw new StoreError(`WooCommerce returned HTTP ${response.status}.` + (response.status >= 500 ? uncertain : ''));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new StoreError('WooCommerce returned an empty response.' + uncertain);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new StoreError('WooCommerce response exceeded the 2 MB limit.' + uncertain);
        }
        chunks.push(chunk.value);
      }
      const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) throw new StoreError('WooCommerce returned an invalid response.' + uncertain);
      const count = (name: string) => {
        const text = response.headers.get(name);
        if (!text || !/^\d+$/.test(text)) return null;
        const number = Number(text);
        return Number.isSafeInteger(number) ? number : null;
      };
      return { data: parsed.data, total: count('X-WP-Total'), totalPages: count('X-WP-TotalPages') };
    } catch (error) {
      if (error instanceof StoreError) throw error;
      if (signal.aborted) throw new StoreError('WooCommerce request timed out.' + uncertain);
      if (error instanceof SyntaxError) throw new StoreError('WooCommerce returned invalid JSON.' + uncertain);
      throw new StoreError('Could not reach WooCommerce; check store connectivity and redirects.' + uncertain);
    }
  }
}
