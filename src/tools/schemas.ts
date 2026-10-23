import * as z from 'zod/v4';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pagination = {
  page: z.number().int().min(1).max(1_000_000).default(1),
  per_page: z.number().int().min(1).max(100).default(10),
};
export const orderStatuses = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;
export const writableStatuses = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'failed'] as const;
// Refunds require a separate financial operation; this tool does not issue them.
export const listProductsInput = z.strictObject(pagination);
export const getOrderInput = z.strictObject({ order_id: id });
export const listOrdersInput = z.strictObject({
  ...pagination,
  status: z.enum(orderStatuses).optional(),
  after: z.iso.datetime({ offset: true, precision: 0 }).optional(),
  before: z.iso.datetime({ offset: true, precision: 0 }).optional(),
}).refine(v => !v.after || !v.before || Date.parse(v.after) < Date.parse(v.before), {
  message: 'after must be earlier than before',
});
export const createProductInput = z.strictObject({
  name: z.string().trim().min(1).max(200),
  regular_price: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/, 'Use a nonnegative decimal string with at most two decimal places'),
  description: z.string().max(2000).optional(),
  sku: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  status: z.enum(['draft', 'publish']).default('publish'),
});
export const updateOrderStatusInput = z.strictObject({ order_id: id, status: z.enum(writableStatuses) });

export const productSchema = z.object({
  id, name: z.string(), price: z.string(), status: z.string(), permalink: z.string(),
});
// z.object strips everything else, including billing addresses, emails and order keys.
export const orderSchema = z.object({
  id, number: z.string(), status: z.string(), currency: z.string(), total: z.string(),
  date_created: z.string().nullable(), date_created_gmt: z.string().nullable(),
  line_items: z.array(z.object({ id, product_id: z.number().int().nonnegative(), name: z.string(), quantity: z.number().nonnegative(), total: z.string() })),
});
export type OrderSummary = z.infer<typeof orderSchema>;
