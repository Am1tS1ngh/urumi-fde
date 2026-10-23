# Part 1 — From an empty workspace to a working store

> Urumi AI FDE internship course · Written for Nikhil · Updated 22 October 2026  
> Level: beginner. Read this part before the adapter code.  
> Next: [Part 2 — Build and understand the five MCP tools](02-nestjs-and-five-mcp-tools.md)

## Course navigation

1. **This document:** understand the assignment, prepare the workspace, learn the infrastructure vocabulary, and run a real WooCommerce store.
2. **[Part 2](02-nestjs-and-five-mcp-tools.md):** follow the NestJS adapter, understand every tool, and verify real store calls.
3. **[Part 3](03-gateway-to-final-submission.md):** build the gateway, accounts, dashboard, audits and chat, then deploy and demonstrate the complete system.

This is a guided course for this repository, not a claim that the complete platform already exists. Work through one checkpoint at a time. Predict a result before running a command, compare the result with the prediction, and explain the reason for any difference.

**Document labels**

- **Implemented:** present in the current repository.
- **Previously verified:** a check actually passed during development; rerun it to check your current machine.
- **Build next:** a proposed step for functionality that is not implemented yet.
- **Required:** comes from the assignment brief.
- **Recommendation:** a design choice we can revise.

Commands in Parts 1 and 2 refer to existing files. Part 3 explicitly marks commands that depend on files we still need to create. Do not execute future placeholders as if those files exist.

## Contents

- [1. Understand the assignment](#1-understand-the-assignment)
- [2. Understand the application before the infrastructure](#2-understand-the-application-before-the-infrastructure)
- [3. Learn just enough HTTP](#3-learn-just-enough-http)
- [4. Meet Docker Kubernetes and Helm](#4-meet-docker-kubernetes-and-helm)
- [5. Open the workspace](#5-open-the-workspace)
- [6. Understand project initialization](#6-understand-project-initialization)
- [7. Prepare local Kubernetes](#7-prepare-local-kubernetes)
- [8. Read the store chart](#8-read-the-store-chart)
- [9. Deploy and inspect the store](#9-deploy-and-inspect-the-store)
- [10. Set up WordPress and WooCommerce](#10-set-up-wordpress-and-woocommerce)
- [11. Place a real demonstration order](#11-place-a-real-demonstration-order)
- [12. Prepare credentials and HTTPS](#12-prepare-credentials-and-https)
- [13. Troubleshoot in layers](#13-troubleshoot-in-layers)
- [14. Review before Part 2](#14-review-before-part-2)

## 1. Understand the assignment

### The problem in everyday language

Imagine a team that uses several systems. One contains shop orders. Another contains a company handbook. A third performs calculations. Each system exposes operations through its own MCP server.

The team should not configure those servers separately for every person. An administrator connects them once. A gateway gives each member one endpoint and a personal key. A dashboard lets the administrator manage access, and a chat interface can use those same operations.

Your WooCommerce store supplies real products and orders. It gives us something meaningful to read and change, rather than a demonstration that always returns a hardcoded answer.

### What the brief requires

The official eight-page PDF is the source of truth:

- Pages 2–3: four layers, admin/member stories, and the two-user demonstration.
- Pages 3–5: mandatory Kubernetes, adapter, gateway, access, audit and chat requirements.
- Pages 5–7: optional bonus and differentiators.
- Pages 7–8: video, submission and repository deliverables.

The hiring email sets the deadline: **26 October 2026 at 11:59 PM IST**. 

The mandatory end result includes:

- One real WooCommerce store in Kubernetes.
- A WooCommerce MCP server that we write ourselves.
- Five store operations over Streamable HTTP.
- A gateway connected to at least three upstream MCP servers in total.
- A React dashboard and backend with admin/member access.
- Individual revocable API keys stored as hashes.
- An audit record for every tool invocation.
- A real LLM chat tool loop through the gateway.
- Connectivity from an external MCP client.
- All application components deployed in Kubernetes through Helm.
- Persistent storage, Secrets, stable Ingress URLs, probes and resource settings.
- A reproducible repository, design/threat notes and a real demo video.

**Five working store tools complete one important component. They do not complete the whole assignment.**

### Required versus optional

A production-like deployment path using the same Helm charts is required. Actually renting a VPS and demonstrating a remote deployment is a differentiator. We can document a credible production path without purchasing hosting.

Basic admin/member separation is required. Fine-grained per-tool permissions, OAuth, multiple stores, advanced metrics and multiple gateway replicas are optional. Security controls explicitly required for the core—such as secret isolation and gateway-only adapter access—remain required.

### Your starting checkpoint

As of this writing:

- The Kubernetes store exists.
- Manual checkout has worked.
- NestJS hosts our five-tool adapter.
- Fixture and real-store adapter checks have passed.
- The adapter still runs on the Windows host.
- The complete gateway, dashboard, identity system and chat are not built.

**Exercise 1:** describe the four application layers without using implementation names such as NestJS or MySQL.

## 2. Understand the application before the infrastructure

### The store has three responsibilities

**WordPress** serves the website and provides its administration interface.

**WooCommerce** is a WordPress plugin. It adds catalog, cart, checkout and order functionality.

**MySQL** stores application records. WordPress files also need storage, including installed plugins and uploaded content.

A browser request to the storefront eventually reaches WordPress. WordPress loads WooCommerce, reads or changes database records, and returns the page or JSON response.

```text
Browser
  -> storefront hostname
  -> Ingress
  -> WordPress and WooCommerce
  -> MySQL
  <- page or API response
```

### Why store files and database records are separate

A product row belongs in the database. Its uploaded photograph is usually a file. Preserving only the database is insufficient if the application later loses its plugin files or uploads.

Our chart therefore requests two persistent volumes:

- MySQL data directory.
- WordPress content directory.

### MCP is the next layer

MCP stands for Model Context Protocol. It lets a client discover named operations and call them through a standard interface.

Our adapter translates a tool such as `get_order` into a WooCommerce REST request. An LLM is not required to make that call. A test script can be the MCP client.

The gateway will act as an MCP server for its callers and an MCP client for its upstreams. It must enforce identity and routing in code rather than trusting a model to choose correctly.

See the [official MCP architecture overview](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture).

**Exercise 2:** explain why a working storefront does not prove that an MCP server or gateway works.

## 3. Learn just enough HTTP

A request has a method, destination, headers and sometimes a body.

```http
GET /wp-json/wc/v3/orders/14 HTTP/1.1
Host: localhost:8443
Authorization: Basic <server-generated-value>
Accept: application/json
```

The value in angle brackets is explanatory, not a credential to copy.

For this project:

- `GET` reads products or orders.
- `POST` creates a product.
- `PUT` changes an order's status.
- A successful response has an HTTP status and a body.
- `401` means authentication is missing or invalid.
- `403` means the request is forbidden.
- `404` means the requested resource or route was not found.
- `429` indicates rate limiting.
- `5xx` indicates a server-side failure.

MCP adds its own protocol-level and tool-level results on top of HTTP. A tool can return an MCP result containing `isError: true` even when the transport exchange itself succeeded.

### Three addresses with different jobs

- `127.0.0.1:6550`: local Kubernetes API, used by kubectl.
- `store.localhost:8080`: storefront route through local Ingress.
- `127.0.0.1:3001/mcp`: current host adapter endpoint.

The store API also has an HTTPS route at `https://localhost:8443`.

`localhost` always refers to the environment making the request. Inside a gateway container, it means the gateway container's own network environment—not your Windows host or a different pod. Later we will use Kubernetes Service DNS names.

### Authentication versus authorization

Authentication answers “Who is calling?” Authorization answers “What may this caller do?”

A member's personal gateway key identifies the member. Their admin/member role controls management operations. The gateway's upstream credential is a separate server-side credential. We do not forward the member's key to WooCommerce.

**Exercise 3:** if a member supplies a valid key, should they automatically be allowed to delete an upstream server? Explain.

## 4. Meet Docker Kubernetes and Helm

### Docker

An image packages application code and dependencies. A container is a running instance of an image.

Docker Desktop provides a Linux engine on this Windows machine. “Docker Desktop is open” and “the engine can run containers” are different checks.

### Kubernetes

Kubernetes manages the desired state of applications. In this course:

- A **Pod** runs one application container.
- A **Deployment** maintains a requested number of pods.
- A **Service** gives matching pods a stable network address.
- A **Namespace** groups related resources.
- An **Ingress** describes hostname-based HTTP routing.
- An **Ingress controller** actually handles that routing; our cluster uses Traefik.
- A **Secret** supplies sensitive values to workloads.
- A **PersistentVolumeClaim**, or PVC, requests durable storage.
- A **probe** helps Kubernetes decide whether to start, route to or restart a container.

A resource request guides scheduling. A resource limit caps consumption. Memory limits can cause an application to be terminated when it exceeds its allocation.

Read the [Kubernetes concepts](https://kubernetes.io/docs/concepts/) alongside the resources in our chart.

### Helm

Helm packages Kubernetes templates into a chart. Values supply configuration such as hostnames, storage sizes and image tags. A release is one installed instance of a chart.

We use the same store templates with separate local and production-example values. Changing environments should not require maintaining a second copy of every manifest.

The [official chart guide](https://helm.sh/docs/topics/charts/) explains the format. Our installer pins Helm 4.3.1; some general chart documentation still carries Helm 4 migration notices, so check command-specific documentation when adapting options.

### Local distribution

k3d runs K3s inside Docker containers. That gives us a small local cluster. It is not a separate hosted cloud service.

```text
Windows
  -> Docker Desktop Linux engine
     -> k3d containers
        -> K3s Kubernetes
           -> application pods
```

**Checkpoint:** explain the difference between a Docker image, a Kubernetes Deployment and a Helm release.

## 5. Open the workspace

### Use your editor

Open this folder in VS Code or the editor you already use:

```text
D:\123\Other FIles\Interview Preparation\urumi-mcp-gateway
```

In VS Code, open a Markdown file and choose **Open Preview to the Side**. Mermaid diagrams may require Mermaid preview support; the plain-text explanations remain sufficient if your preview does not render them.

Open an integrated PowerShell terminal:

```powershell
Set-Location 'D:\123\Other FIles\Interview Preparation\urumi-mcp-gateway'
Get-Location
Get-ChildItem -Name
```

Expected: the location ends in `urumi-mcp-gateway`, and you see `package.json`, `src`, `scripts`, `charts` and `docs`.

### Know the current folders

```text
urumi-mcp-gateway/
  src/                    adapter source
    mcp/                  MCP registration and middleware
    tools/                tool contracts
  test/                   fixture tests and cluster regression test
  scripts/                setup, startup and smoke checks
  charts/store/           existing Helm chart
  docs/                   guides and this three-part course
  .local/                 ignored tools, CA files and kubeconfig
  dist/                   generated JavaScript
  node_modules/           installed packages
  .env                    ignored local credentials
  .env.example            safe configuration template
```

`dist` and `node_modules` are generated. Read source under `src`. Never paste your `.env`, kubeconfig or private key contents into chat.

## 6. Understand project initialization

### For your existing repository

Do not run a new Nest scaffolder over this project. It would introduce another structure and could overwrite files we already understand.

Use:

```powershell
node --version
npm.cmd --version
npm.cmd ci
npm.cmd run typecheck
```

Expected: Node satisfies the repository's `>=22.13.0` requirement; npm restores the lockfile dependency tree; type checking exits successfully. This phase does not require Docker.

`npm ci` replaces installed dependencies according to the lockfile. Keep source changes saved first; it does not implement missing application features.

### How the project begins from an empty folder

This subsection explains the construction sequence. Use a separate empty practice directory if you want to recreate it.

1. Create the project directory and run `npm init -y`.
2. Set the package to ESM with `"type": "module"`.
3. Install the pinned dependencies from our package manifest.
4. Add TypeScript configuration.
5. Create one REST client method.
6. Register one MCP tool.
7. Prove discovery and invocation using fixtures.
8. Add Nest's module/provider structure.
9. Add the other four tools with their checks.

The repository's current application dependencies are:

For a separate, empty practice folder only, the first commands would be:

```powershell
New-Item -ItemType Directory -Path urumi-practice
Set-Location urumi-practice
npm.cmd init -y
npm.cmd pkg set type=module
```

Expected: a new package.json with ESM enabled. This creates no working MCP server
yet. Return to the real repository to use its lockfile and source; do not paste
later run commands into this empty practice folder and expect them to work.

- `@modelcontextprotocol/server@2.3.1`.
- `@modelcontextprotocol/node@2.1.1`.
- `@nestjs/common@12.2.0`.
- `@nestjs/core@12.2.0`.
- `@nestjs/platform-express@12.2.0`.
- `reflect-metadata@0.2.2`.
- `rxjs@7.8.2`.
- `zod@4.6.7`.

Development dependencies include TypeScript, tsx, Node types and the MCP client SDK. Use the repository lockfile for exact reproducibility rather than installing unspecified “latest” versions.

The essential TypeScript settings include:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"],
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist"
  }
}
```

This is an excerpt, not the complete configuration. The actual file also selects source, test and script paths. ESM imports use `.js` extensions because those are the names in the compiled output.

**Exercise 4:** explain what the lockfile preserves that `package.json` alone may not preserve.

## 7. Prepare local Kubernetes

### Step 7A — Check the engine

```powershell
docker info --format '{{.ServerVersion}}'
```

Expected: an engine version, not a pipe connection error. If the engine is unavailable, stop here and resolve Docker startup first.

This machine previously ran out of C: space. Docker's active data disk was moved through Docker Desktop to D:. Moving the data location is different from moving the Docker Desktop program. Do not manually remove VHDX copies, reset Docker or prune unrelated projects as a troubleshooting shortcut.

### Step 7B — Install the local command tools

```powershell
.\scripts\install-local-tools.ps1
```

The script downloads pinned k3d and Helm releases and verifies SHA-256 checksums before execution. Binaries live under ignored `.local/tools`. Docker and kubectl must already be available.

Expected: k3d and Helm print their pinned versions. If a checksum fails, stop; do not bypass the check.

### Step 7C — Create or resume the cluster

```powershell
.\scripts\create-local-cluster.ps1
```

This script:

1. Checks the Docker engine.
2. Searches for the existing `urumi` cluster.
3. Starts it if found.
4. Refuses to replace unexplained existing urumi containers.
5. Creates a single-node cluster only when one does not exist.
6. Writes a private project kubeconfig.
7. Waits for the node to become Ready.

It does not activate WooCommerce or install the gateway.

### Step 7D — Inspect the result

```powershell
kubectl --kubeconfig .local/kubeconfig get nodes
kubectl --kubeconfig .local/kubeconfig get pods -A
.\.local\tools\helm.exe version --short
```

Expected: one Ready node and system workloads becoming available. A Ready node alone does not prove Ingress or WordPress works.

### Step 7E — Understand the regression test

```powershell
powershell.exe -NoProfile -File test/cluster-detection.test.ps1
```

Expected: four cluster-discovery cases pass. The test protects against a PowerShell 5.1 JSON-array behavior that previously caused an existing cluster to be missed.

**Checkpoint:** explain why a running load balancer might occupy port 6550 while kubectl still cannot reach the Kubernetes server.

## 8. Read the store chart

Open `charts/store`.

- `Chart.yaml` identifies the package.
- `values.yaml` supplies defaults.
- `values-local.yaml` selects small local storage and local hostnames.
- `values-prod.yaml` is a production example, not proof of a deployed VPS.
- `templates/mysql.yaml` defines the database Service and Deployment.
- `templates/wordpress.yaml` defines WordPress networking and its Deployment.
- `templates/storage.yaml` requests the two volumes.
- `templates/health-configmap.yaml` contains PHP health checks and the safer Apache access-log configuration.
- `templates/ingress.yaml` routes browser/API traffic.
- `templates/_helpers.tpl` shares names and labels.

### Follow one Secret reference

```yaml
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: store-database
      key: mysql-password
```

This illustrates the rendered relationship; the template uses the configurable Secret name. Kubernetes supplies the password. It does not belong in a committed values file.

A Secret is not automatically encrypted merely because it is a Secret object. Cluster access, storage encryption and RBAC still matter. See the [official Secrets documentation](https://kubernetes.io/docs/concepts/configuration/secret/).

### Understand our database deployment choice

MySQL currently uses a one-replica Deployment with a `Recreate` strategy and a PVC. This prevents the normal rollout from starting two writers on the same directory. It is a small local deployment, not a highly available database.

### Understand health checks

- Startup gives initialization time.
- Readiness decides whether traffic should be routed to the pod.
- Liveness detects a process that should be restarted.

Our WordPress readiness performs a database query. Liveness checks PHP/process response without making every database failure restart WordPress. MySQL readiness performs a query as its application user.

Neither check proves that checkout, MCP or the LLM works. Study the [official probe documentation](https://kubernetes.io/docs/concepts/workloads/pods/probes/).

### Understand storage limits

PVCs have a keep annotation to reduce accidental deletion on Helm uninstall. That is not a backup. Local-path data may still be lost with cluster/node deletion or disk failure. Record the difference between pod replacement, application rollback and data recovery.

## 9. Deploy and inspect the store

### Step 9A — Deploy the existing chart

```powershell
.\scripts\deploy-store-foundation.ps1
```

The script lints, checks namespace/API access, creates or reuses the database Secret, validates rendered resources against the API and performs a Helm upgrade/install.

For an initialized store, it preserves the existing data. It does not rotate an initialized database user's password merely by changing a Kubernetes Secret.

### Step 9B — Inspect

```powershell
kubectl --kubeconfig .local/kubeconfig -n urumi get deployments,pods,pvc,svc,ingress
.\.local\tools\helm.exe status store --kubeconfig .local/kubeconfig -n urumi
```

Expected: WordPress and MySQL are available, PVCs are Bound, and the store Ingress exists.

Open **http://store.localhost:8080**.

A setup page on a fresh installation is expected. On your existing installation, the storefront or login page is expected.

### Step 9C — Read failures before changing resources

```powershell
kubectl --kubeconfig .local/kubeconfig -n urumi get events --sort-by=.lastTimestamp
kubectl --kubeconfig .local/kubeconfig -n urumi describe deployment store-wordpress
```

Use targeted logs when needed. Logs can contain sensitive data; redact before sharing. Our new Apache format omits consumer-key usernames and queries, but historical logs were not erased.

**Verification:** local and production-example chart lint passed previously. Re-run lint after chart edits. Lint proves template/chart checks, not a working production deployment.

## 10. Set up WordPress and WooCommerce

**Fresh store only:** do not reinstall your working store.

1. Open the WordPress installation page.
2. Choose a demo title such as Urumi Demo Store.
3. Choose your own administrator username.
4. Save a strong password privately.
5. Supply your email.
6. Discourage indexing for the demonstration site.
7. Install WordPress and sign in.
8. Open Plugins, find WooCommerce, install it and activate it.
9. Complete the store's basic setup.
10. Skip optional marketing subscriptions, paid extensions and unnecessary third-party connections.
11. Configure a usable permalink structure and save it.
12. Review store address, INR currency and timezone.

The existing store was configured through the admin interface. A fully automated fresh-store bootstrap is still pending. The final README must honestly document the manual steps unless we automate and verify them.

### Timezone checkpoint

The current WordPress installation reported **UTC−05:30**, while India uses **UTC+05:30**. This course does not silently change the existing setting. Review it deliberately before the final “orders today” demonstration and retest date filtering afterward.

Changing how times are displayed is different from altering historical timestamps. Part 2 explains the adapter's explicit-offset inputs.

## 11. Place a real demonstration order

### Step 11A — Add a product

Create a simple published product. For your original exercise:

- Name: First Product.
- Regular price: 199.
- Stock: available.

A product image is optional for our technical milestone.

### Step 11B — Enable a test-friendly checkout

Enable Cash on delivery, or another dummy method. Configure a simple shipping option if the chosen product requires shipping. Do not connect a live payment provider for this demonstration.

### Step 11C — Visit as a customer

Use a private browser window so the admin session does not mask a public-access problem.

1. Open the storefront.
2. Find the product.
3. Add it to the cart.
4. Check out with clearly synthetic customer information.
5. Confirm the order-received screen.
6. Open WooCommerce admin and locate the same order.

If the store remains in Coming soon mode, publish access appropriately for the demonstration and test again in a private window.

### What was previously verified

Your original product is ID **12**. Your manual order is ID **14**, total INR **199.00**, status **Processing**. These identifiers belong to this installation; a fresh installation will assign different IDs.

This proves a real checkout. It does not yet prove that a chat agent can create a product or list orders through the gateway.

**Exercise 5:** explain why checking only the administrator's product screen is insufficient evidence of a publicly visible product.

## 12. Prepare credentials and HTTPS

### Step 12A — Generate the WooCommerce integration credential

In WooCommerce settings, open the Advanced REST API area. Create an integration key with the permissions required for product creation and order updates.

The local demonstration currently needs Read/Write access. Prefer a dedicated integration user when moving beyond the initial admin-based demo.

Save the consumer key and secret only in the project-root `.env`. Never publish the generated screen.

### Step 12B — Preserve a working environment file

Only if `.env` is missing:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

Edit the credentials locally. The expected variable names are:

```dotenv
WOOCOMMERCE_URL=https://localhost:8443
WOOCOMMERCE_CONSUMER_KEY=<your-private-value>
WOOCOMMERCE_CONSUMER_SECRET=<your-private-value>
MCP_UPSTREAM_TOKEN=<separate-random-token>
WOOCOMMERCE_ALLOW_HTTP=false
PORT=3001
```

These placeholders are not valid credentials.

### Step 12C — Prepare the development certificate

If Python lacks the required local certificate dependency, use a suitable development environment and install:

```powershell
python -m pip install -r scripts/requirements-local-tls.txt
```

Then:

```powershell
.\scripts\setup-local-https.ps1
node scripts/configure-local-adapter.mjs
```

The certificate script creates a local CA certificate and signed server certificate. The CA signing private key is not persisted; the server private key is stored privately under `.local/tls` and provisioned as a Kubernetes TLS Secret.

The setup script accepts `-Python` if you need to select a specific Python executable. It applies TLS routing and preserves the existing store.

`configure-local-adapter.mjs` preserves the store credential, chooses the local HTTPS URL and creates a separate adapter token if required. It does not print the credential values.

### Step 12D — Understand trust and DNS

Node on this Windows machine did not resolve `store.localhost` reliably. The Ingress accepts `localhost` too, so Node uses `https://localhost:8443`.

The startup wrapper sets `NODE_EXTRA_CA_CERTS` before Node starts. This trusts the local certificate without disabling verification or installing a system-wide CA.

Encryption currently covers adapter-to-Ingress traffic. Ingress-to-WordPress is internal HTTP. Do not describe that as end-to-end internal TLS.

The server certificate is valid for 90 days. Expiration and regeneration need deliberate handling; the script refuses partial or expired certificate sets rather than silently overwriting them.

## 13. Troubleshoot in layers

Work from the lowest failing layer upward.

### Layer 1 — Docker

**Symptom:** the engine command fails.  
**Check:** Docker Desktop's actual error and engine state.  
**Action:** resolve startup first. Application manifests cannot fix a stopped engine.

### Layer 2 — Cluster

**Symptom:** kubectl cannot connect to port 6550.  
**Check:** existing k3d cluster and its server container, not just its load balancer.  
**Action:** resume the existing cluster script; preserve volumes.

### Layer 3 — Pods and storage

**Symptom:** Pending, CrashLoopBackOff or ImagePullBackOff.  
**Check:** describe the pod and read events.  
**Action:** identify storage, image, configuration or resource failure before changing limits.

### Layer 4 — Ingress

**Symptom:** pods Ready but browser cannot reach the site.  
**Check:** host, port, Ingress class, controller, Service and endpoints.  
**Action:** trace the route rather than reinstalling WordPress.

### Layer 5 — Application

**Symptom:** WordPress responds but checkout or REST fails.  
**Check:** plugin activation, permalink settings, coming-soon access, payment/shipping and credentials.

### Layer 6 — Adapter

**Symptom:** store works but the MCP call fails.  
**Check:** Part 2's auth, TLS, validation and tool-error guidance.

Keep a short troubleshooting note: symptom, hypothesis, check, result and fix. That becomes interview evidence of how you reasoned.

## 14. Review before Part 2

### Completion checklist

- [ ] I can open and navigate the source in my editor.
- [ ] I can explain HTTP methods and the three local ports.
- [ ] Docker responds and the existing cluster can be resumed.
- [ ] WordPress and MySQL are Ready and both PVCs are Bound.
- [ ] I can explain the Ingress and both volumes.
- [ ] A customer can check out and the order appears in admin.
- [ ] Credentials are private and local HTTPS trust is configured.
- [ ] I understand that the host adapter is an intermediate checkpoint.

### Explain in your own words

1. Why do we need both database and WordPress storage?
2. What is the difference between Docker, Kubernetes and Helm?
3. Why does a Secret reference belong in YAML but a secret value not belong in Git?
4. What proves a checkout worked?
5. Why is the final gateway still necessary?

### Suggested study routine

Read one section, run its relevant existing check, and explain the result aloud. If the result differs, investigate that layer before advancing. Do not spend the remaining deadline memorizing every Kubernetes feature.

**Continue:** [Part 2 — NestJS and the five MCP tools](02-nestjs-and-five-mcp-tools.md).

<details>
<summary>Check your understanding after answering the review questions</summary>

1. The database preserves records; the WordPress volume preserves files such as plugins and uploads. Both are needed for this deployment.
2. Docker runs containers, Kubernetes manages workloads, and Helm installs/configures their resource templates.
3. A Secret reference identifies where to obtain a value. Committing the value would publish the credential itself.
4. A customer receives confirmation and the same order exists in WooCommerce admin. A homepage response alone does not prove checkout.
5. The gateway must combine several upstreams and enforce individual identity, revocation and audit attribution.

If your explanation differs, trace the actual request rather than memorizing this answer key.

</details>

