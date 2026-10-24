# Urumi MCP Gateway

One MCP endpoint for a whole team. The gateway sits in front of several MCP
servers, merges their tools, checks each member's own API key, routes every call
to the right server and records who called what. A React dashboard manages
servers, people and keys, shows the audit log, and has a chat that uses the same
tools as the signed-in member.

Everything runs on Kubernetes and is installed with Helm:

| Part | Where |
| --- | --- |
| Gateway (NestJS) | [gateway/](gateway/) |
| Dashboard (React + Vite) | [dashboard/](dashboard/) |
| WooCommerce MCP adapter (NestJS) | [src/](src/) |
| Utilities MCP server | [mcp-servers/utils/](mcp-servers/utils/) |
| MCP reference server, pinned | [mcp-servers/everything/](mcp-servers/everything/) |
| WordPress, WooCommerce and MySQL | [charts/store/](charts/store/) |
| Gateway, dashboard, Postgres and MCP servers | [charts/platform/](charts/platform/) |

Read [the design notes](docs/DESIGN.md) for how requests flow, the tool naming
rule, failure handling and upgrades, and [the threat model](docs/THREAT_MODEL.md)
for the security reasoning. [The checklist](docs/CHECKLIST.md) maps every
requirement to the build.

## Run it on a local cluster

You need Windows with Docker Desktop running, plus `kubectl`. The scripts download
pinned, checksum-verified `k3d` and `helm` into the ignored `.local/` folder.

```powershell
.\scripts\install-local-tools.ps1
.\scripts\create-local-cluster.ps1
.\scripts\deploy-store-foundation.ps1
.\scripts\deploy-platform.ps1
```

- The store deploy creates the database and setup Secrets, installs the store
  chart, then runs a Job that installs WooCommerce, enables cash on delivery and
  creates the adapter's REST API key.
- The platform deploy builds all five images with a fresh tag, imports them into
  k3d and runs `helm upgrade --install`.
- Generated secrets are saved once in `.local/platform-secrets.env` and reused on
  every run.

Then open:

- Dashboard: <http://gateway.localhost:8080>. Sign in as `admin@urumi.local`
  with `ADMIN_PASSWORD` from `.local/platform-secrets.env`.
- Store: <http://store.localhost:8080>. The WordPress admin is
  `STORE_ADMIN_USER` / `STORE_ADMIN_PASSWORD` from the same file.
- MCP endpoint for clients: `http://127.0.0.1:8080/mcp`, with a member key as the
  bearer token. Node on Windows cannot resolve `*.localhost`, so clients use the IP.

Chat needs an OpenAI-compatible API with tool calling. The default is Groq with
`openai/gpt-oss-120b`. Add a key, then restart the gateway so it reads the
updated Secret:

```powershell
.\scripts\create-local-secrets.ps1 -LlmApiKey '<your key>'
kubectl --kubeconfig .local\kubeconfig -n urumi-platform rollout restart deployment gateway
```

### Production-like settings

`values-prod.yaml` in each chart shows what changes for a real server: a DNS
name, TLS Secret, storage class and registry images. The templates are the same
ones used locally. Create the same Secrets with your own values, then:

```bash
helm upgrade --install store charts/store -n urumi -f charts/store/values-prod.yaml --wait
helm upgrade --install platform charts/platform -n urumi-platform -f charts/platform/values-prod.yaml --wait
```

See [Upgrades and rollback](docs/DESIGN.md#upgrades-and-rollback).

## Connect an MCP client

Create a key on the **API keys** page. Any client that speaks Streamable HTTP only
needs the URL and that key:

```json
{
  "mcpServers": {
    "urumi": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": { "Authorization": "Bearer mcpk_..." }
    }
  }
}
```

Tools appear as `<server>__<tool>`, for example `woo__list_orders` or
`utils__convert_currency`.

## Develop without Kubernetes

Each service runs on its own with Node 22.13 or newer.

1. Start Postgres:
   `docker run -d --name gateway-pg -e POSTGRES_USER=gateway -e POSTGRES_PASSWORD=gateway -e POSTGRES_DB=gateway -p 5433:5432 postgres:17.7-alpine`
2. In `mcp-servers/utils`: `npm ci`, set `UTILS_MCP_API_KEY` to any value of 16 or more
   characters, then `npm start`. It listens on port 3002.
3. In `gateway`: `npm ci`, copy `.env.example` to `.env`, fill in the blanks, then
   `npm run dev`. It listens on port 3000.
4. In `dashboard`: `npm ci` and `npm run dev`. Open <http://localhost:5173>. Vite
   forwards `/api` and `/mcp` to the gateway.

The WooCommerce adapter's own local setup, with HTTPS and a live store, is in
[docs/live-store-mcp.md](docs/live-store-mcp.md).

## Tests

```powershell
npm test                          # adapter: tools, validation, HTTP and auth
cd gateway; npm test              # gateway: crypto, tool names, SSRF guard, time zones
cd mcp-servers\utils; npm test    # utils server over a real MCP client
cd dashboard; npm run build       # type checks and builds the dashboard
```

## Walkthrough of the acceptance flow

1. **Storefront order.** Open the store, add the sample T-shirt to the cart and check
   out with cash on delivery. The order shows in WooCommerce > Orders.
2. **User A creates a product in chat.** Sign in as the admin and ask: *Create a
   product called Blue Mug priced at 499.* The tool trace shows `woo__create_product`.
3. **Manual order, read back in chat.** In WordPress, add an order for Blue Mug, then
   ask in chat: *Show me the latest order.*
4. **User B with an external client.** Invite B on the **Members** page. B accepts,
   creates a key, and configures their MCP client with the URL and key only.
5. **Discovery and retrieval.** B's client lists tools and calls `woo__get_order`.
6. **Two servers in one prompt.** *What is order 42 worth in US dollars?* uses
   `woo__get_order` and then `utils__convert_currency`.
7. **Revocation.** B revokes the key, or an admin does. B's next call is refused
   and the attempt is logged as denied.
8. **Disable a server.** Disable Utilities on **Servers**. Its tools disappear from
   chat and from B's client on the next `tools/list`.
9. **Outage.** `kubectl -n urumi-platform scale deployment everything-mcp --replicas=0`.
   The server shows **Unreachable** and every other tool keeps working. Scale it
   back to 1 to recover.
10. **Audit.** The **Audit log** shows every call with the user, server, tool,
    outcome and whether it came from chat or an MCP client.
