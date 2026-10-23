# NestJS WooCommerce MCP implementation guide

Prepared for Nikhil on 22 October 2026.

We now have a self-written WooCommerce MCP server hosted by NestJS with all five required store tools. A real SDK client discovered and invoked the tools against your Kubernetes store. This guide explains the component, the code, the checks we ran, and the work still required for the complete assignment.

This milestone completes the five-tool adapter. It does not complete the gateway, dashboard, team access, chat agent or full Kubernetes application deployment. The submission deadline remains 26 October 2026 at 11:59 PM IST.

# Part 1 Understand what we built

## Start with the store

WordPress is the website application. WooCommerce adds products, checkout and orders to WordPress. MySQL stores the website and order records. WordPress files and the database use persistent Kubernetes volumes so replacing an application pod does not erase the store.

Your original First Product is ID 12. Your manually placed order is ID 14, worth INR 199.00 with Processing status. The new verification created a separate product and order; it did not change order 14.

The WooCommerce REST API lets a program perform store operations. For example, GET /wp-json/wc/v3/orders/14 retrieves an order. Access requires the store consumer key and secret.

## What an MCP tool means

A tool is a named operation that another program can discover and call. It has a description, an input schema and a handler. The schema is a contract: get_order accepts a positive numeric order_id, not an arbitrary URL or database query.

MCP standardizes discovery and invocation for clients. Our implementation uses the official TypeScript SDK to handle the protocol. We wrote the five contracts, store calls, authentication boundary, selected responses and failure behavior.

A host is an application that uses MCP. Its MCP client connects to an MCP server. In this milestone the smoke script is that client, and our NestJS application is the server. No paid LLM or model subscription is needed to test these tools.

Streamable HTTP is the transport between the SDK client and /mcp. The SDK handles protocol discovery, version negotiation and invocation messages. An HTTP GET from a browser is not a tool call. The tests exercise both the SDK modern discovery flow and its legacy initialization flow.

## The five tools in plain language

1. list_products reads a page of products.
2. create_product adds a simple product with a name and price.
3. list_orders reads a page of orders, optionally limited by status or creation time.
4. get_order reads one order using its ID.
5. update_order_status changes one order to an allowed status.

These are five MCP operations behind one /mcp endpoint, not five public REST controllers. GET /healthz is a separate process-health endpoint.

## The current request journey

SDK client
  -> loopback HTTP /mcp with adapter bearer token
  -> NestJS middleware checks Host and Origin and authenticates
  -> official MCP SDK discovers or validates a tool call
  -> McpService invokes a WooCommerceClient method
  -> HTTPS localhost port 8443 with WooCommerce Basic authentication
  -> Traefik Ingress
  -> WordPress and WooCommerce over internal HTTP
  -> MySQL
  <- selected JSON fields become MCP text content

The current adapter runs on your Windows host. The store runs in Kubernetes. The connection from the adapter to Ingress validates the local certificate chain and hostname. The internal Ingress-to-WordPress hop is HTTP.

The final architecture adds a gateway between external clients and this adapter. The gateway will also connect to two other upstream MCP servers. It must combine tool discovery, route calls and apply member authentication and audit attribution. That gateway is still pending.

## Why NestJS is here

NestJS organizes related code into modules, controllers and providers. The WooCommerceModule groups our adapter dependencies. HealthController handles /healthz. McpService is the provider that owns the MCP handler and its shutdown hook.

WooCommerceClient is a plain TypeScript class registered as a Nest provider. Nest receives the configured instance and injects it into McpService through an explicit provider factory. Keeping the REST client independent makes its behavior easy to test.

We use the official MCP SDK inside Nest middleware. We do not recreate MCP as ordinary REST routes. Nest body parsing is disabled because the SDK must read the original HTTP stream.

## Two credentials with different jobs

MCP_UPSTREAM_TOKEN authenticates a client or future gateway to this adapter. The WooCommerce consumer key and secret authenticate the adapter to the store. A caller never needs the store secret.

At this checkpoint, a valid adapter token grants access to all five tools. Read/write tool annotations are descriptive hints; they do not implement user permissions or require approval. Individual gateway member keys, roles, revocation and audit records still need implementation.

# Part 2 Read the code and understand each tool

## Read these files in order

The main application source now consists of seven files.

- src/main.ts reads configuration, constructs the store client, starts NestJS on loopback and handles shutdown.
- src/server.ts creates the Nest application, disables body parsing, installs MCP middleware and exposes a close method for tests.
- src/woocommerce.module.ts declares the Nest module, health controller and provider factories.
- src/health.controller.ts implements GET /healthz.
- src/mcp/mcp.service.ts registers all five MCP tools, checks adapter authentication and closes the SDK handler when Nest shuts down.
- src/tools/schemas.ts defines strict input contracts and selected output fields using Zod.
- src/woocommerce.ts implements five public store methods and one shared private HTTP request method.

Test files are test/woocommerce.test.ts and test/five-tools.test.ts. scripts/smoke-live-store.ts checks the real store. scripts/run-local-adapter.ps1 starts Node with the trusted development CA and restores the shell environment afterward.

Dependency manifests now include pinned NestJS common, core and platform-express 12.2.0, reflect-metadata and rxjs. tsconfig.json enables TypeScript decorators. The MCP server and client SDK packages remain at 2.3.1, with the Node transport adapter at 2.1.1.

## Understand the shared request method

Each store method first validates its arguments. It constructs a fixed resource path and delegates to request. Callers cannot supply a target host or an arbitrary path. Configuration chooses the single store.

request builds the URL, adds an Authorization header, sends GET, POST or PUT, and validates the response. The default deadline is five seconds, including response-body reading. The response body is limited to 2 MB. Redirects and automatic retries are disabled.

The output schema selects fields and strips extras. An order contains ID, number, status, currency, total, creation dates and selected line-item fields. Billing and shipping addresses, customer email, IP address, payment secrets, order keys and arbitrary metadata are not returned.

The selected data is still business data. Product names and line-item text are untrusted input. A future chat agent must treat them as data rather than instructions.

## Tool 1 list products

Input defaults are page 1 and per_page 10. Page must be a positive integer up to 1000000; per_page must be from 1 to 100. Extra input fields are rejected.

Example MCP arguments:

```json
{"page":1,"per_page":10}
```

The adapter sends GET /wp-json/wc/v3/products?page=1&per_page=10. The result contains products, page and per_page. Each product has id, name, price, status and permalink.

This method reads one page rather than loading the whole catalog. A caller requests another page explicitly. The returned price remains a string, following the store representation.

Exercise: change per_page to 1 in a fixture call. Explain why per_page 101 must fail before a store request is sent.

## Tool 2 create product

Required arguments are name and regular_price. Optional arguments are description, sku and status. Name is trimmed and limited to 200 characters. Description is limited to 2000 characters. SKU permits 1 to 64 letters, digits, underscores or hyphens. Status is draft or publish, defaulting to publish.

```json
{"name":"Demo notebook","regular_price":"79.00","sku":"DEMO-NOTEBOOK-1","status":"draft"}
```

The adapter sends POST /wp-json/wc/v3/products with type fixed to simple. regular_price must be a nonnegative decimal string with at most two fractional digits and at most nine integer digits. Numeric values, scientific notation and negative prices are rejected. This is a deliberately small INR-demo contract; arbitrary currency precision and variable products are outside this milestone.

The result contains product with the selected product fields. A product's returned price is the store's current price, not a floating-point calculation in our adapter.

Creating a product changes persistent state. A timed-out request may already have created it. Inspect the store, including the SKU, before retrying. The adapter does not promise exactly-once creation.

Exercise: explain why regular_price is input while price is output, and why a timeout is not proof that nothing was created.

## Tool 3 list orders

Arguments include page, per_page and an optional single status. Optional after and before values must be ISO timestamps containing seconds and an explicit Z or timezone offset. When both are present, after must be earlier than before.

```json
{"status":"processing","after":"2026-10-21T00:00:00+05:30","before":"2026-10-22T00:00:00+05:30","per_page":20}
```

This example expresses a day in Indian Standard Time. The adapter converts both instants to UTC. It sends GMT wall-clock strings with dates_are_gmt=true to WooCommerce. For this example, after becomes 2026-10-20T18:30:00 and before becomes 2026-10-21T18:30:00.

During real testing, a trailing Z in the upstream query caused WordPress to convert the date into site time even while querying GMT. Omitting that suffix after UTC conversion, together with the GMT flag, passed the containing-range and excluding-range checks.

The store currently reports timezone -05:30. This differs from IST, which is +05:30. We did not silently change that setting or reinterpret existing orders. Always use explicit input offsets and date_created_gmt for comparisons. Review the store timezone separately before relying on dates shown in its dashboard.

The result contains orders, page, per_page, total and total_pages. Totals come from actual WooCommerce pagination headers. Missing or invalid total headers yield null, not invented counts. after/before behavior is delegated to WooCommerce; avoid assuming inclusive boundaries. The verification uses a one-minute margin around an order timestamp.

Exercise: explain why the same instant can have different clock times and why “today” needs a timezone.

## Tool 4 get order

```json
{"order_id":14}
```

The adapter sends GET /wp-json/wc/v3/orders/14 and returns order. IDs must be positive safe integers. Text IDs, fractions, zero, negatives and extra arguments are rejected.

An HTTP 404 from WooCommerce becomes a controlled resource-not-found tool error. It does not expose the upstream response body.

Exercise: point to the output schema that removes customer email. Explain why successful store authentication alone does not decide which member should see an order in the final gateway.

## Tool 5 update order status

```json
{"order_id":16,"status":"processing"}
```

The adapter sends PUT /wp-json/wc/v3/orders/16 with only the status field. Writable statuses are pending, processing, on-hold, completed, cancelled and failed. The response contains the selected updated order.

refunded and trash are intentionally excluded from this tool. Marking an order refunded is not the same as issuing a financial refund. This adapter does not implement refunds or deletion. Read filters can include refunded orders.

WooCommerce decides whether the authenticated integration may update an order and performs its normal hooks. Changes may trigger email, stock or payment-related behavior configured by the store. We do not implement a separate transition state machine. The final agent should request user confirmation for writes, but that confirmation flow does not exist yet.

Exercise: explain why a status change may have consequences beyond changing one database field.

## Security and failure handling

Strict input schemas reject unknown fields before a store request. A fixed configured origin and redirect rejection protect store credentials from caller-selected destinations. HTTPS is the default for the store; fixture HTTP requires explicit opt-in.

The adapter checks its bearer token on every /mcp request using a length check and timingSafeEqual. It validates localhost Host and Origin values and binds to 127.0.0.1. This is a local development boundary, not completed gateway-only Kubernetes isolation.

Store failures become isError tool results with controlled messages. HTTP authentication failures, missing resources, other HTTP errors, malformed responses, oversized bodies and timeouts have distinct safe messages. Raw upstream bodies and nested network errors are not returned. Write timeouts, invalid responses and server errors warn that the outcome may be unknown.

We also changed the store Apache access-log format. Basic authentication uses the WooCommerce consumer key as its username; the default format printed that field. The Helm configuration now omits usernames, query strings, referers and user agents. This prevents future logging of that username; it does not erase prior logs or rotate existing keys.

The adapter does not yet provide member authorization, durable audit logs, rate limits or production readiness checks. /healthz only proves that this process can answer HTTP.

# Part 3 Run it and verify the results

## Start in the correct directory

Open the project folder in VS Code or your editor. In PowerShell:

```powershell
Set-Location 'D:\123\Other FIles\Interview Preparation\urumi-mcp-gateway'
```

Docker Desktop must show Engine running for real-store checks. Start the existing cluster without deleting it:

```powershell
.\scripts\create-local-cluster.ps1
kubectl --kubeconfig .local/kubeconfig -n urumi get pods,pvc
```

Expected: the cluster node is Ready, WordPress and MySQL pods are 1/1 Running, and both PVCs are Bound. The cluster script preserves an existing urumi cluster and its data. Do not delete the cluster to resolve a port conflict.

The existing .env and .local/tls/ca.crt must remain present. Do not copy .env.example over a working .env. If rebuilding from scratch, follow docs/live-store-mcp.md to generate credentials and prepare local HTTPS.

## Run checks without touching the real store

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The fixtures use synthetic credentials and local HTTP servers. Docker and real store credentials are not required for these tests. The expected suite result is 25 passed, 0 failed.

The tests use actual SDK client connections to the Nest application. They cover discovery, legacy compatibility, all five mappings, timezone conversion, strict inputs, selected outputs, missing pagination headers, bearer authentication, hostile Host/Origin, HTTP failures, body limits, redirects and timeouts. The delayed-body case verifies that the deadline continues after response headers arrive.

## Run a read only real store check

```powershell
.\scripts\run-local-adapter.ps1 -Smoke
```

The script starts a temporary adapter on an available loopback port. It verifies HTTP 401 without a token, authenticated discovery of all five tools, the original product, get_order and date-filter behavior. It closes the client and Nest application afterward.

This command does not invoke create_product or update_order_status. Its output records writes_enabled false. The default demonstration expects First Product at price 199 and order ID 14. Override SMOKE_PRODUCT_NAME, SMOKE_PRODUCT_PRICE or SMOKE_ORDER_ID for another small store. This smoke test searches only the first 100 products and orders where applicable.

## Run the explicit write check

```powershell
.\scripts\run-local-adapter.ps1 -Smoke -WriteChecks
```

This command changes the store. It creates a uniquely labelled published product priced at INR 49.00, arranges a separate synthetic COD order through REST, and calls update_order_status through MCP to change that order from on-hold to processing.

The REST arrangement is test setup. create_order is not a sixth MCP tool. The script reads the order again to confirm the new status persisted, finds the created product and order through list tools, and checks that order 14 retained its original status.

Each write-check run creates additional demo records, which remain visible for inspection. Do not rerun automatically after an ambiguous failure. Inspect products, SKUs and orders first.

A sanitized result is written to .local/five-tools-verification.json. It contains tool names, dates, public demo identifiers, statuses and result evidence; it does not contain store credentials or billing addresses. A later smoke run replaces this local evidence file.

## What was actually verified

On 22 October 2026, the expanded fixture suite reported 25 passed and zero failures. Type checking and TypeScript build passed. The real SDK smoke completed with writes enabled.

The live run created product ID 15 named MCP Verification Mug MCP-DEMO-1792676565571, priced at 49.00. It created separate order ID 16 with total 49.00 and confirmed its transition from on-hold to processing through MCP. Order ID 14 remained processing with total 199.00.

The real date tests included order 14 in a narrow range around its GMT creation time and excluded it from a following-day range. These checks caught and verified the timezone-query fix.

The store chart was upgraded successfully to apply the safer Apache log format. Both PVCs remained Bound with their existing volume identities. These results prove the adapter milestone in this local environment; they do not prove a deployed gateway, external client product interoperability, multi-user isolation or production operation.

## Keep the adapter running

```powershell
.\scripts\run-local-adapter.ps1
```

Expected: a listening message for http://127.0.0.1:3001/mcp. In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/healthz
```

Expected: status is ok. Stop the server with Ctrl+C. Use an MCP client for /mcp; opening the URL in a browser does not invoke a tool. The tests and smoke script show the SDK client connection and bearer header without exposing real credentials.

## Troubleshooting

- Cannot connect to Kubernetes: wait for Docker Engine running, run create-local-cluster.ps1 and inspect the existing cluster. Starting only its load balancer does not ensure the Kubernetes server is running.
- Port 6550 conflict: inspect the existing cluster before starting another one. The API endpoint and application port 3001 have different jobs.
- Store timeout after startup: wait until WordPress and MySQL are ready. Retry a read check after the store warms up. Inspect the store before retrying a timed-out write.
- Store access denied: check the WooCommerce integration user's permissions, key revocation and Read/Write setting. The adapter bearer token is a different credential.
- Certificate failure: use run-local-adapter.ps1 so Node trusts the local CA before it starts. Check the certificate validity and TLS Secret. Never disable certificate validation.
- Resource not found: verify the order ID, WooCommerce activation and WordPress permalink configuration.
- Input error: use numeric IDs, quoted decimal prices, allowed status names and explicit date offsets. Do not add arbitrary fields.
- EADDRINUSE for the adapter: stop a previous adapter or change PORT in .env. Smoke checks choose an available port automatically.

## What remains before submission

First, build the gateway that discovers tools from three upstream MCP servers in total, including this adapter. It needs server management, credential isolation, naming rules and fault isolation.

Next, add the React dashboard and backend flows for server management, team invitations, admin/member access, individual hashed and revocable keys, and attributable audit logs.

Then add a real LLM chat tool loop that calls the gateway as the signed-in member, and demonstrate connectivity from an external MCP client.

Deploy every application component through Helm with local and production values. Move credentials into Kubernetes Secrets, implement gateway-only network access to this adapter, and verify probes, limits, storage and stable Ingress URLs.

Finally, reproduce setup from a fresh environment, run the complete two-user demonstration, and prepare design notes, threat model, README, video and GitHub submission. Mandatory features take priority over bonuses.

A suggested remaining order is gateway core first, then identity and audits, then dashboard/chat/external-client flows, then final Helm deployment and end-to-end fixes. Reserve the final day for reproducibility and recording. This is a planning recommendation, not a claim that the remaining work is small or guaranteed to fit.

## Explain it back before the next milestone

1. What does NestJS do here, and what does the MCP SDK do?
2. Trace get_order from the SDK client to MySQL and back.
3. Why are the adapter token and WooCommerce credentials separate?
4. Why does a timed-out write need inspection before retrying?
5. Why do five working tools still leave substantial assignment work?

Practice by opening each source file and answering aloud without reading this guide. Then compare your explanation with the code. If one step is unclear, focus on that step before adding the gateway.

## Official documentation to study

- NestJS modules: https://docs.nestjs.com/modules
- NestJS providers: https://docs.nestjs.com/providers
- NestJS lifecycle: https://docs.nestjs.com/fundamentals/lifecycle-events
- MCP architecture: https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture
- Official TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- WooCommerce products API: https://developer.woocommerce.com/docs/apis/rest-api/v3/products/
- WooCommerce orders API: https://developer.woocommerce.com/docs/apis/rest-api/v3/orders/

The assignment brief defines the mandatory tool names and project scope. NestJS module layout, the small product contract, response field selection, restricted write statuses and the testing structure are engineering choices made for this implementation.
