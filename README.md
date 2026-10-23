# Urumi MCP Gateway assignment

Work in progress. The WooCommerce MCP adapter now uses **NestJS** and implements
all five required store tools over **Streamable HTTP**:

- `list_products`
- `create_product`
- `list_orders`
- `get_order`
- `update_order_status`

The adapter runs locally on the host. WordPress, WooCommerce and MySQL run in
the existing local Kubernetes cluster with persistent storage and Helm.
The gateway, two additional upstream servers, dashboard, team access, audits,
chat and complete application deployment remain pending.

## Start with the guide

For the complete beginner-to-submission course, read these three Markdown parts
in order. They include theory, source walkthroughs, exercises, verification and
the remaining build sequence. Future designs are explicitly marked as pending.

1. [Foundations and the store](docs/course/01-foundations-and-store.md)
2. [NestJS and the five MCP tools](docs/course/02-nestjs-and-five-mcp-tools.md)
3. [Gateway through final submission](docs/course/03-gateway-to-final-submission.md)

Read [the five tool implementation guide](docs/five-tools-guide.md) for the
beginner explanation, NestJS architecture, contracts, file walkthrough, exercises,
commands, verified results and remaining requirements. A Word edition is included
as `docs/NestJS_WooCommerce_Five_Tools_Guide.docx`.

Earlier infrastructure guides remain useful:

- [Local Kubernetes](docs/local-kubernetes.md)
- [Store foundation](docs/store-foundation.md)
- [Local HTTPS and credentials](docs/live-store-mcp.md)

## Verify without a real store

Node.js 22.13+ and npm are required.

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected: **25 passed, 0 failed**. These tests use synthetic HTTP fixtures and real
SDK client connections to NestJS. They need neither Docker nor real credentials.
The pinned SDK server/client packages are 2.3.1, Node adapter 2.1.1, and NestJS
common/core/platform-express 12.2.0.

## Verify the real local store

Open Docker Desktop and wait for Engine running. From the project directory:

```powershell
.\scripts\create-local-cluster.ps1
kubectl --kubeconfig .local/kubeconfig -n urumi get pods,pvc
.\scripts\run-local-adapter.ps1 -Smoke
```

The existing ignored `.env` and local CA must be configured. For fresh setup,
follow the HTTPS guide; do not overwrite working credentials with the example.
The read-only smoke expects First Product at 199 and original order 14.

The following command **creates a labelled product and separate demo order** and
changes that new order's status. Each execution adds records:

```powershell
.\scripts\run-local-adapter.ps1 -Smoke -WriteChecks
```

Do not automatically retry failed writes; inspect the store first. The sanitized
result is saved to ignored `.local/five-tools-verification.json`.
The script arranges its demo order through REST; `create_order` is not an MCP tool.

To keep the adapter running instead:

```powershell
.\scripts\run-local-adapter.ps1
```

Health: `http://127.0.0.1:3001/healthz`. MCP: `http://127.0.0.1:3001/mcp`,
with the adapter bearer token. No paid API is required for this milestone.

## Verified checkpoint on 22 October 2026

Typecheck, 25 fixture tests and build passed. A real SDK client discovered all
five tools and invoked them against WooCommerce. Product 15 was created at 49.00,
and separate order 16 changed from on-hold to processing and was read back.
Original order 14 retained processing status and total 199.00. Date filters
included the original order in its GMT range and excluded it from another day.

The store Helm rollout applied an Apache log format that omits authenticated
usernames (WooCommerce consumer keys), queries, referers and user agents.
Existing PVCs were preserved. This affects future access logs; prior logs are not
erased. Local and production-example chart lint passed.

## Security boundaries

Store credentials stay in the server environment; the adapter uses a separate
bearer token. Requests have strict input validation, fixed store paths, HTTPS
by default, redirect rejection, a five-second deadline and 2 MB response cap.
Order responses omit billing/shipping details, customer email, order keys and
arbitrary metadata. Write errors may have an unknown outcome; no retries occur.

Tool annotations are hints, not member authorization or enforced confirmation.
A valid adapter token currently allows all five tools. The host adapter is bound
to loopback. Kubernetes Secret injection, gateway-only NetworkPolicy, member
identity, hashed revocable keys and audit attribution remain to be built.
Health checks do not prove end-to-end store availability.

## Mandatory work still pending

- Reproducible store setup from a fresh deployment.
- Gateway upstream CRUD/disable, credentials, discovery aggregation, collision
  policy, routing, timeouts and isolated failures, with three upstreams total.
- React dashboard and backend for servers, invitations, admin/member access,
  member keys, hashing and immediate revocation.
- Tool audit records and dashboard views.
- Real LLM chat loop through the gateway as the member.
- External MCP client and complete two-user demonstration.
- Every application workload deployed by Helm, shared local/production values,
  Secrets, storage, probes, resource limits, Ingress and gateway-only adapter access.
- Reproducibility, threat/design notes, upgrade/rollback story, video and GitHub
  submission.

The official assignment PDF is the requirements source. The hiring email gives
the deadline as **26 October 2026 at 11:59 PM IST**. Optional bonus work follows
the mandatory core.

## Official references

- [NestJS modules](https://docs.nestjs.com/modules)
- [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/)
