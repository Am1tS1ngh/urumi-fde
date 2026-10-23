# Urumi MCP Gateway — Core Requirements Checklist

Mark each item by changing `[ ]` to `[x]`. On GitHub you can also tick the boxes directly in the rendered file.

---

## 1. System layers

- [x] **Store**: WordPress and WooCommerce, backed by a persistent database
- [x] **WooCommerce MCP adapter**: self-written server exposing product and order operations over Streamable HTTP
- [x] **Gateway and dashboard**: React dashboard plus backend that manages upstream servers, aggregates their tools and exposes one MCP endpoint
- [x] **Chat agent**: LLM-based assistant that invokes tools through the gateway as the logged-in user

## 2. Store

- [x] WordPress, WooCommerce and MySQL run in Kubernetes
- [x] Database and WordPress content persist across pod restarts
- [x] Customers check out through the storefront (the checkout does not pass through the adapter)
- [x] Orders placed in the storefront appear in WooCommerce admin
- [x] Store setup is reproducible from a fresh deployment (no manual setup steps)

## 3. WooCommerce MCP adapter

- [x] `list_products`: list a page of products
- [x] `create_product`: create a simple product
- [x] `list_orders`: list orders with status and date filters
- [x] `get_order`: retrieve one order by ID
- [x] `update_order_status`: change an order's status
- [x] Served over Streamable HTTP
- [x] WooCommerce credentials stay server-side
- [x] Reachable only through the gateway

## 4. Gateway

- [x] Register an upstream MCP server
- [x] Edit an upstream
- [x] Disable an upstream
- [x] Remove an upstream
- [x] Optional upstream credentials: bearer token
- [x] Optional upstream credentials: custom header
- [x] Tool discovery aggregated across all enabled upstreams
- [x] Tool-name collision handling, documented
- [x] Each call routed to the correct upstream
- [x] Timeouts on every upstream request
- [x] One failing or slow upstream does not affect the others
- [x] **Three upstreams connected**: WooCommerce adapter
- [x] **Three upstreams connected**: additional server #1
- [x] **Three upstreams connected**: additional server #2
- [x] One gateway MCP endpoint, used by both external clients and the dashboard chat

## 5. Dashboard and team access

- [x] Built with React
- [x] Server status view (Connected / Unreachable / Disabled)
- [x] Exposed-tools view per server
- [x] Server-management controls (add / edit / disable / remove)
- [x] Invitations
- [x] Admin role
- [x] Member role
- [x] Members can create their own gateway keys
- [x] Keys stored hashed (never in plain text)
- [x] Revoking a key rejects the very next call
- [x] Audit log records every tool call
- [x] Audit log viewable in the dashboard
- [x] Members never receive upstream credentials

## 6. Chat agent and external clients

- [ ] Real LLM tool-calling loop through the gateway
- [x] Tool calls shown in the chat (visible trace)
- [x] Chat calls attributed to the logged-in member
- [x] External MCP client connects using only the gateway URL and a member key
- [x] One prompt successfully uses tools from two different upstreams

## 7. Kubernetes deployment

- [x] Adapter runs inside Kubernetes
- [x] Gateway backend runs inside Kubernetes
- [x] Dashboard runs inside Kubernetes
- [x] Application credentials supplied through Kubernetes Secrets
- [x] Gateway-only access to the adapter is enforced
- [x] Helm deploys every required application workload
- [x] Probes on every workload
- [x] Resource requests and limits on every workload
- [x] Persistent storage where data must survive
- [x] Stable public routes (Ingress)

## 8. Final acceptance flow

- [x] 1. Storefront checkout, with the resulting order visible in WooCommerce admin
- [ ] 2. User A creates a product through the dashboard chat
- [ ] 3. A manually placed order for that product is retrieved through chat
- [x] 4. User B connects an external MCP client using only the gateway URL and B's key
- [x] 5. Tools from enabled servers are discovered, and order retrieval succeeds
- [ ] 6. One external-client prompt uses two different upstreams
- [x] 7. Revocation rejects B's next call
- [x] 8. Disabling an upstream removes its tools from both the chat and the external client
- [x] 9. An upstream outage leaves the other servers usable and shows Unreachable status
- [x] 10. The tool audit log attributes calls to the correct user

---

## Verification notes (24 Oct 2026, local k3d cluster)

- Fresh cluster, `deploy-store-foundation.ps1` and `deploy-platform.ps1`: every pod is ready. The store setup Job
  installs WooCommerce 11.2.1, and a second run changes nothing.
- Storefront checkout through the WooCommerce Store API (what the checkout page calls) created order 12. It was
  read back through `woo__get_order` via the gateway.
- External MCP client through the Ingress: 31 tools from 3 servers, product created, orders listed, currency
  converted, utils disabled and re-enabled, key revoked and refused on the next call, all audited under the right user.
- Scaling `everything-mcp` to zero shows Unreachable while the other 9 tools keep working. It reconnects on the next check.
- A pod without the gateway label is refused by all three MCP servers. A pod with it gets through.
- Helm rollback to an earlier revision and forward again kept all data.
- Chat ran end to end against a stand-in OpenAI-compatible model (two tools on two servers in one turn, traced and
  audited as `chat`). The four open items need a run with a real `LLM_API_KEY`.
