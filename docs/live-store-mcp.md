# First real WooCommerce MCP call

Historical checkpoint from 21 October. The current NestJS adapter now has five
tools. Read [the current guide](five-tools-guide.md) for its contracts and smoke
checks. The default smoke remains read only; adding `-WriteChecks` creates demo
records and changes a separate demo order. The HTTPS setup below still applies.

This checkpoint connects the existing `list_products` tool to real WooCommerce.
It does not add the four remaining tools, an LLM, the gateway, or a NestJS backend.

## Understand the flow

An SDK MCP client connects to a temporary loopback adapter server, authenticates
with the adapter token, discovers `list_products`, and calls it. The adapter makes
an HTTPS request to `https://localhost:8443/wp-json/wc/v3/products`, sending the
WooCommerce key/secret in an Authorization header. Traefik verifies the requested
host route, terminates TLS and forwards HTTP internally to WordPress. WooCommerce
checks the credential and returns actual products; the adapter validates and
selects fields before returning MCP content.

Two different credentials are involved:

- `MCP_UPSTREAM_TOKEN`: client/gateway -> adapter authentication.
- WooCommerce consumer key/secret: adapter -> store authentication. These are not
  forwarded to the MCP client. The eventual gateway member keys are a third layer.

TLS encryption covers the adapter-to-Ingress connection; the Ingress-to-WordPress
hop is HTTP inside this local cluster. This checkpoint does not claim mutual TLS,
encrypted internal Service traffic, or gateway-only NetworkPolicy enforcement.

## Local HTTPS and DNS

The storefront remains at `http://store.localhost:8080`. Node's Windows resolver
did not resolve `store.localhost` on this machine, so the chart also accepts
`localhost` and the adapter uses `https://localhost:8443`.

`scripts/create-local-certificates.py` creates a development CA certificate and a
signed server certificate with `localhost` and `store.localhost` SANs. Files remain
inside ignored `.local/tls/`. The signing CA's private key is not saved. The server
key is provisioned as a Kubernetes TLS Secret, not placed in Helm values.

The server certificate lasts 90 days. The script reuses valid existing files and
refuses to overwrite partial/expired files. Renewal requires explicit regeneration
and reapplying the Secret. Keep all generated private keys out of Git.

`scripts/run-local-adapter.ps1` sets `NODE_EXTRA_CA_CERTS` before starting Node,
then restores the caller's previous environment on exit. This allows certificate
chain/hostname validation without modifying Windows/browser trust. No insecure
certificate bypass is used. A browser need not open the development HTTPS URL.
Windows curl with Schannel may report an unknown revocation status for the offline
development CA; use the verified Node smoke command below rather than disabling
certificate verification.

## Reproduce (PowerShell, project directory)

Prerequisites: Docker, the existing running cluster/store, Node dependencies, and
Python with `cryptography`. For a fresh Python environment, install the pinned
development dependency: `python -m pip install -r scripts/requirements-local-tls.txt`.
This is a free development tool, not a production application dependency.

1. Generate a WooCommerce REST API key under Settings > Advanced > REST API. The
   required read/write product/order operations need Read/Write access. A dedicated
   integration user with suitable store permissions is preferable to an admin key
   beyond the local demo. Save the two values privately in project-root `.env`:

```dotenv
WOOCOMMERCE_CONSUMER_KEY=your_generated_consumer_key
WOOCOMMERCE_CONSUMER_SECRET=your_generated_consumer_secret
```

2. Prepare HTTPS and configuration. Supply `-Python <executable>` if Python is not
   on PATH. `configure-local-adapter.mjs` preserves the consumer credentials, sets
   the local HTTPS URL, disables HTTP opt-in and generates a separate random adapter
   token when needed. It never prints credential values.

```powershell
.\scripts\setup-local-https.ps1
node scripts/configure-local-adapter.mjs
.\scripts\run-local-adapter.ps1 -Smoke
```

Expected: authenticated discovery and tool invocation pass; an unauthenticated
MCP request is rejected with HTTP 401; output includes the public demo product
`First Product` at price 199. WooCommerce may encode that decimal as `"199"` rather
than `"199.00"`; both represent the configured price. The smoke check defaults to
that demo name/price and searches the first 100 products. Override
`SMOKE_PRODUCT_NAME` / `SMOKE_PRODUCT_PRICE` for another small demonstration store.
It is not a general exhaustive store inventory test.

The smoke command starts its own temporary adapter on an available loopback port,
then shuts it down. To keep the development adapter running instead:

```powershell
.\scripts\run-local-adapter.ps1
```

Expected: `WooCommerce MCP listening at http://127.0.0.1:3001/mcp` (unless PORT is
configured differently). Stop with Ctrl+C. No LLM is needed for these checks.

## Other checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
.\.local\tools\helm.exe lint charts/store -f charts/store/values-local.yaml
.\.local\tools\helm.exe lint charts/store -f charts/store/values-prod.yaml
```

Fixture tests continue to use synthetic data. The explicit smoke command is the
real-store test. It does not create products or change existing orders.

## Troubleshooting

- Missing `.env`: save it in the project root, not just the editor's unsaved buffer.
- Missing/invalid credential configuration: copy both values from the key-generation
  screen without extra text. Do not send them in screenshots or chat.
- TLS errors: run the wrapper so Node trusts `.local/tls/ca.crt`; check the correct
  TLS Secret and certificate dates. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Store denied access: inspect the key's user/permissions/revocation and confirm
  the request uses HTTPS. Credentials are not placed in query strings.
- REST 404: verify WooCommerce is active and WordPress uses pretty permalinks.
- Timeout: check pods/readiness and store responsiveness; failed calls return
  controlled errors. The adapter has a five-second store deadline, no automatic retry.
- Wrong product expectation: check the published name/price and smoke variables.

## Remaining deployment boundary

The adapter still runs on the development host for this checkpoint. It is not yet
a cluster Deployment or accessible through the gateway. During that deployment,
move the store credentials and adapter token into Kubernetes Secrets, mount a
trusted certificate bundle, configure internal routing and enforce gateway-only
access. A successful host smoke check does not prove that boundary is implemented.

## Explain it back

1. Why are the WooCommerce credential and adapter token different?
2. What proves this is a real MCP call rather than a direct REST-only test?
3. Why do we explicitly trust a local CA instead of turning TLS verification off?

References: [WooCommerce REST API](https://developer.woocommerce.com/docs/apis/rest-api/),
[Node CA trust](https://nodejs.org/api/cli.html#node_extra_ca_certsfile),
[Kubernetes Ingress TLS](https://kubernetes.io/docs/concepts/services-networking/ingress/#tls).
