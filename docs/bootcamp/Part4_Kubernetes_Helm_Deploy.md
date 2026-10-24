# Urumi MCP Gateway Bootcamp — Part 4 of 5
## Containers, Helm, Secrets, NetworkPolicies: everything in the cluster

> **Format**: freeCodeCamp-style. Small lessons. Type (or have Codex type) every line. Validate. Move on.
>
> **Starting point**: Part 3 done (`checkpoint-local-complete`). The store chart runs in k3d (`urumi` namespace) and the whole platform works on your laptop.
>
> **End state of Part 4**: One `helm upgrade --install` deploys the platform into namespace `urumi-platform`:
> - the gateway with Postgres on a PVC;
> - the dashboard;
> - your WooCommerce MCP adapter, the utils server and the everything server.
>
> Only the dashboard and gateway are reachable from outside (via Traefik at `http://gateway.localhost:8080`). The MCP servers and Postgres are internal, **enforced** by NetworkPolicies you can prove. Secrets live in Kubernetes Secrets, never in the chart.
>
> **Time**: ~8–10 hours (Sat afternoon + evening).

---

## Table of Contents — Part 4

| Phase | Title | What you'll build |
| --- | --- | --- |
| Phase 19 | Container images | 5 Dockerfiles, `.dockerignore`s, nginx config, a patient DB boot |
| Phase 20 | Adapter changes for in-cluster use | Bind address, Host allowlist, in-cluster store URL, curl-pod proof |
| Phase 21 | The platform Helm chart: skeleton | `Chart.yaml`, `values.yaml`, helpers, values files |
| Phase 22 | Workload templates | Postgres StatefulSet, gateway, dashboard, 3 MCP servers, Ingress |
| Phase 23 | Secrets and deploy scripts | `create-platform-secrets.ps1`, `deploy-platform.ps1` |
| Phase 24 | NetworkPolicies | Default deny, explicit allows, proof that internal is internal |
| Phase 25 | Deploy and verify | First install, end-to-end checks, failure demos in the cluster |
| Phase 26 | Operations | Upgrade, rollback, VPS path, optional store bootstrap Job |

**Files added in Part 4:**

```
urumi-mcp-gateway/
├── Dockerfile  .dockerignore                      ← adapter image (repo root)
├── gateway/Dockerfile  gateway/.dockerignore
├── dashboard/Dockerfile  dashboard/.dockerignore  dashboard/nginx.conf
├── mcp-servers/utils/Dockerfile  mcp-servers/utils/.dockerignore
├── mcp-servers/everything/Dockerfile
├── charts/platform/
│   ├── Chart.yaml  values.yaml  values-local.yaml  values-prod.yaml
│   └── templates/_helpers.tpl  postgres.yaml  gateway.yaml  dashboard.yaml  woo-mcp.yaml
│                 utils-mcp.yaml  everything-mcp.yaml  ingress.yaml  networkpolicies.yaml  NOTES.txt
└── scripts/create-platform-secrets.ps1  scripts/deploy-platform.ps1
```

> 🧠 **Intuition — what changes when you move into the cluster?**
> On your laptop, everything found everything else via `127.0.0.1:<port>`, secrets came from `.env` files, and "internal" meant "nobody else is on my laptop." In the cluster:
> - **Addresses** become Service DNS names (`utils-mcp.urumi-platform.svc.cluster.local`).
> - **Secrets** become Kubernetes Secrets injected as env vars.
> - **Internal** becomes a rule enforced by the network (NetworkPolicy), not an assumption.
>
> Your code barely changes. Only configuration does. That's the payoff of the `config.ts` discipline in Part 2.

---

# PHASE 19
## Container images

### Lesson 19.1 — Make the gateway patient with the database

⏱ ~10 min — **Goal:** On first install, the gateway waits for Postgres instead of crash-looping

> 💡 **Why now?**
> In a fresh install, the gateway pod often starts before Postgres accepts connections. Kubernetes would restart it until it works, but `CrashLoopBackOff` in your demo video looks like a bug. A short retry loop looks like engineering.

Edit `gateway/src/bootstrap.service.ts`: replace the first line of `run()` (`await this.db.migrate();`) with a call to a retrying helper, and add the helper:

```typescript
// gateway/src/bootstrap.service.ts — Phase 19 change
  async run(): Promise<void> {
    await this.migrateWithRetry();
    await this.seedAdmin();
    for (const seed of this.config.seedUpstreams) await this.upstreams.seed(seed);
    console.log('[bootstrap] done');
  }

  private async migrateWithRetry(attempts = 30, delayMs = 2_000): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.db.migrate();
        console.log('[bootstrap] schema ready');
        return;
      } catch (err) {
        if (attempt >= attempts) throw err;
        console.warn(`[bootstrap] database not ready (attempt ${attempt}/${attempts}): ${err instanceof Error ? err.message : err}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
```

> ✅ **Validate**
> `docker stop gateway-pg`, start the gateway (it logs "database not ready…" every 2 s), then `docker start gateway-pg`, and the gateway finishes booting. Total patience is ~60 s, which fits inside the startup probe budget you'll set in Phase 22.

---

### Lesson 19.2 — Gateway image

⏱ ~15 min — **Goal:** A small, non-root production image

> 🧠 **Intuition — multi-stage builds = kitchen vs. plate**
> Stage 1 is the kitchen: compilers, dev dependencies, mess. Stage 2 is the plate: only the cooked food (`dist/` + production `node_modules`). The customer (cluster) never sees the kitchen, so the image is smaller with less attack surface.

Create `gateway/Dockerfile`:

```dockerfile
# gateway/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

Create `gateway/.dockerignore`:

```
node_modules
dist
.env
.env.*
!.env.example
test
scripts
*.log
```

> ✅ **Validate**
> ```powershell
> PS> docker build -t urumi/gateway:test gateway
> PS> docker run --rm urumi/gateway:test node -e "console.log('ok')"
> PS> docker run --rm urumi/gateway:test sh -c "ls -a /app; id"
> ```
> The build succeeds. `/app` has only `dist`, `node_modules` and `package.json` (**no `.env`**), and `id` shows `uid=1000(node)`.

> ⚠️ **Heads up**
> - The build fails with `Cannot find module` at runtime → a relative import is missing `.js` (it works under `tsx` but not compiled). Fix the import.
> - `npm ci` fails → `package-lock.json` is out of sync. Run `npm install` locally and commit the lockfile.

---

### Lesson 19.3 — Dashboard image (nginx, unprivileged)

⏱ ~15 min — **Goal:** Static files served by nginx on port 8080 as a non-root user, with SPA fallback and security headers

Create `dashboard/nginx.conf`:

```nginx
# dashboard/nginx.conf
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  server_tokens off;

  # Security headers (inherited by every location below because none of them uses add_header)
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;

  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok";
  }

  # Hashed build assets: cache for a year.
  location /assets/ {
    expires 1y;
    try_files $uri =404;
  }

  # Everything else is the SPA (e.g. /invite/<token>): always revalidate index.html.
  location / {
    expires -1;
    try_files $uri /index.html;
  }
}
```

Create `dashboard/Dockerfile`:

```dockerfile
# dashboard/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Pin a current tag: check hub.docker.com/r/nginxinc/nginx-unprivileged/tags
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
```

Create `dashboard/.dockerignore`:

```
node_modules
dist
*.log
```

> ✅ **Validate**
> ```powershell
> PS> docker build -t urumi/dashboard:test dashboard
> PS> docker run --rm -p 8099:8080 urumi/dashboard:test
> ```
> `http://localhost:8099/invite/abc` returns the app (not a 404). The API calls fail because there's no gateway behind it, which is expected. The Ingress provides that in the cluster.

> 🎤 **Interview angle — "Why does nginx inherit headers only if locations don't use `add_header`?"**
> "It's an nginx gotcha: `add_header` in a `location` *replaces* all inherited headers rather than adding to them. That's why I used `expires` (which sets Cache-Control without `add_header`) inside locations, so the security headers at server level apply everywhere."

---

### Lesson 19.4 — Utils and everything images

⏱ ~10 min

Create `mcp-servers/utils/Dockerfile`:

```dockerfile
# mcp-servers/utils/Dockerfile
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3002
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
USER node
EXPOSE 3002
CMD ["node", "server.mjs"]
```

Create `mcp-servers/utils/.dockerignore`:

```
node_modules
*.log
```

Find a current version of the reference server, then pin it:

```powershell
PS> npm view @modelcontextprotocol/server-everything version
```

Create `mcp-servers/everything/Dockerfile` (replace `<VERSION>` with what npm printed):

```dockerfile
# mcp-servers/everything/Dockerfile
FROM node:22-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /app
RUN npm init -y >/dev/null \
 && npm install --omit=dev @modelcontextprotocol/server-everything@<VERSION> \
 && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["./node_modules/.bin/mcp-server-everything", "streamableHttp"]
```

> ✅ **Validate**
> ```powershell
> PS> docker build -t urumi/everything-mcp:test mcp-servers/everything
> PS> docker run --rm -p 3009:3001 urumi/everything-mcp:test
> ```
> The log says it's listening on 3001. If the CLI argument is wrong for your version, `--help` shows the right one (`streamableHttp` vs `streamable-http`).

> ⚠️ **Heads up — the time-box rule**
> If `everything` won't work in a container within **30 minutes**, set `everythingMcp.enabled=false` in values and seed **DeepWiki** instead (Phase 21 shows how). Three upstreams is the requirement, and which third one you use isn't.

---

### Lesson 19.5 — Adapter image (repo root)

⏱ ~20 min — **Goal:** Your existing adapter in a container, without leaking `.env` or `.local`

> ⚠️ **Heads up — this is the riskiest `.dockerignore` in the project**
> The repo root contains `.env` (real WooCommerce keys) and `.local/` (kubeconfig, generated secrets). `COPY . .` without a `.dockerignore` bakes them into an image layer **forever**, even if a later step deletes them. Write the `.dockerignore` *before* the Dockerfile.

Create `.dockerignore` at the repo root:

```
# secrets and local state: NEVER in an image
.env
.env.*
!.env.example
.local
*.pem
*.key

# other deployables have their own images
gateway
dashboard
mcp-servers
charts
docs
scripts
urumi-bootcamp

# build + tooling noise
node_modules
dist
coverage
.git
.github
.vscode
*.log
```

Create `Dockerfile` at the repo root. **Check your adapter's `package.json` first**: the build script name, the output folder, and the entry file may differ from `dist/main.js`.

```dockerfile
# Dockerfile (repo root): WooCommerce MCP adapter
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

> 🤖 **Codex prompt**
> ```
> In the repo root (the WooCommerce MCP adapter), check package.json and tsconfig to confirm: the build
> command, the compiled output directory, and the production entry file. Update the root Dockerfile so
> the final stage copies the right folder and the CMD runs the right entry file. Do NOT copy .env or
> .local into the image. Then run: docker build -t urumi/woo-mcp:test . and
> docker run --rm urumi/woo-mcp:test ls -a /app. Show me the output.
> ```

> ✅ **Validate**
> ```powershell
> PS> docker build -t urumi/woo-mcp:test .
> PS> docker run --rm urumi/woo-mcp:test sh -c "ls -a /app; ls -a /app/dist | head"
> ```
> There's no `.env`, no `.local` and no `src`. (`docker history urumi/woo-mcp:test` is another way to check what each layer added.)

---

# PHASE 20
## Adapter changes for in-cluster use

### Lesson 20.1 — What has to change, and why

⏱ ~10 min — **Goal:** Know exactly which three assumptions break inside a pod

| Laptop assumption | Why it breaks in a pod | Change |
| --- | --- | --- |
| Listen on `127.0.0.1` | Other pods (the gateway) can't reach a loopback listener | Bind address from `HOST` env (`0.0.0.0` in the cluster) |
| Host/Origin must be `localhost`/`127.0.0.1` | The gateway sends `Host: woo-mcp.urumi-platform.svc.cluster.local:3001` | Allowed hosts from `MCP_ALLOWED_HOSTS` env (comma-separated) |
| Store at `https://localhost:8443` with a local CA | `localhost` inside a pod is the pod itself | Use the in-cluster WordPress Service over HTTP, with `X-Forwarded-Proto: https` |

> 🧠 **Intuition — why `X-Forwarded-Proto: https`?**
> WooCommerce only accepts consumer-key **basic auth** over HTTPS (so keys aren't sent in clear text on the internet). Inside the cluster, traffic is pod-to-pod HTTP. The official WordPress image's `wp-config-docker.php` already says "if the request says it was forwarded from HTTPS, treat it as HTTPS," which is exactly what Traefik does for normal browser traffic. The adapter adds the same header, as a reverse proxy would.
>
> 🎤 **Is that a security hole?** The header is only honoured because the WordPress Service isn't public. The only things that can reach it are inside the cluster (and you can lock that down further with a NetworkPolicy in the store namespace). Say exactly that.

---

### Lesson 20.2 — Prove the store path works BEFORE touching code

⏱ ~15 min — **Goal:** A curl pod reaches the WooCommerce REST API using the in-cluster URL

**Step 1.** Find the WordPress Service:

```powershell
PS> $env:KUBECONFIG = "$PWD\.local\kubeconfig"
PS> kubectl get svc -n urumi
```

Note the WordPress service name and port (e.g. `store-wordpress` on port 80).

**Step 2.** Run a throwaway curl pod with your **real** consumer key and secret (from your adapter `.env`; don't paste them into any file):

```powershell
PS> kubectl run curl-test -n urumi --rm -it --restart=Never --image=curlimages/curl -- `
      curl -sS -i -H "X-Forwarded-Proto: https" -u "ck_xxx:cs_xxx" `
      "http://<wp-svc>.urumi.svc.cluster.local/wp-json/wc/v3/products?per_page=1"
```

> ✅ **Validate**
> `HTTP/1.1 200 OK` and a JSON array with one product.

> ⚠️ **Heads up — what other results mean**
>
> | Result | Meaning | Fix |
> | --- | --- | --- |
> | `401 woocommerce_rest_cannot_view` | WordPress didn't treat the request as HTTPS | Check `kubectl exec` into the WordPress pod: `grep -n FORWARDED /var/www/html/wp-config.php`. If missing, add the snippet via the store chart's `WORDPRESS_CONFIG_EXTRA` env (see below) |
> | `301` to `http://store.localhost:8080/...` | WordPress canonical redirect | Try the `?rest_route=/wc/v3/products` form, or make the adapter send `Host: store.localhost` |
> | `Could not resolve host` | Wrong service name/namespace | Re-check `kubectl get svc -n urumi` |
> | Timeout | A NetworkPolicy in `urumi` blocks it | Allow ingress to WordPress from namespace `urumi-platform` |
>
> `WORDPRESS_CONFIG_EXTRA` snippet (only if needed):
> ```php
> if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && str_contains($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https')) { $_SERVER['HTTPS'] = 'on'; }
> ```

---

### Lesson 20.3 — Implement the three adapter changes

⏱ ~45 min — **Goal:** Same adapter code runs on your laptop *and* in a pod, controlled only by env vars

> 🤖 **Codex prompt — do this in one focused change**
> ```
> In the WooCommerce MCP adapter (repo root, src/), make these backward-compatible changes. Defaults
> must keep today's local behaviour exactly (bind 127.0.0.1, current localhost Host/Origin rules,
> HTTPS store with NODE_EXTRA_CA_CERTS).
>
> 1. Bind address: read HOST from env (default "127.0.0.1") and pass it to app.listen(port, HOST).
> 2. Host/Origin validation: read MCP_ALLOWED_HOSTS (comma-separated, case-insensitive, may include
>    ":port" entries). If set, a request is allowed when its Host header (with or without port) is in
>    the list, in ADDITION to the existing localhost rules. Origin, if present, must still be one of
>    the allowed hosts. Keep rejecting everything else with the existing error.
> 3. Store requests: add optional env WOO_FORWARDED_PROTO. When set (e.g. "https"), every request to
>    the WooCommerce REST API includes the header "X-Forwarded-Proto: <value>". The store base URL
>    already comes from env; make sure plain http:// is accepted ONLY when the existing HTTP opt-in
>    flag is enabled (do not weaken the default).
> 4. Add these variables to .env.example with comments. Do not touch .env.
> 5. Add/extend unit tests: allowed host with port, allowed host without port, rejected host, and the
>    forwarded-proto header being sent when configured.
> Run the tests and typecheck, and show me the diff.
> ```

What the core logic looks like (so you can **review** Codex's diff, and explain it):

```typescript
// Sketch: Host allowlist check (your adapter's structure will differ)
const extraAllowed = (process.env.MCP_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  const bare = host.replace(/:\d+$/, '');
  return isLocalhost(bare) || extraAllowed.includes(host) || extraAllowed.includes(bare);
}
```

```typescript
// Sketch: store request headers
const headers: Record<string, string> = {
  Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
  Accept: 'application/json',
};
if (process.env.WOO_FORWARDED_PROTO) headers['X-Forwarded-Proto'] = process.env.WOO_FORWARDED_PROTO;
```

> ✅ **Validate**
> 1. Adapter tests + typecheck pass.
> 2. **Local behaviour unchanged**: `.\scripts\run-local-adapter.ps1 -Smoke` passes exactly as before.
> 3. The gateway (still local) shows `woo` Connected.
>
> **Commit:** `git commit -am "adapter: configurable bind host, host allowlist, forwarded proto"`

> 💡 **What just happened?**
> You changed **policy**, not behaviour: everything new is opt-in through env vars, and the defaults are identical. That's how you change a working service three days before a deadline.

**Step 2.** Create the adapter's in-cluster env file at `.local/woo-mcp.k8s.env` (gitignored). Start from your adapter `.env`, then:
- set the **store base URL** variable to `http://<wp-svc>.urumi.svc.cluster.local`;
- set your adapter's **HTTP opt-in** flag to allow plain HTTP;
- **remove** `NODE_EXTRA_CA_CERTS` (not needed in-cluster);
- **remove** the adapter's MCP bearer-token variable (the chart injects it from `platform-secrets`);
- keep the WooCommerce consumer key/secret variables.

```ini
# .local/woo-mcp.k8s.env (example shape: use YOUR adapter's variable names)
WOO_BASE_URL=http://<wp-svc>.urumi.svc.cluster.local
WOO_ALLOW_INSECURE_HTTP=true
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...
```

> ⚠️ **Heads up**
> Don't replace working credentials with example values, and don't edit your existing `.env`. This is a **new** file for the cluster.

---

# PHASE 21
## The platform Helm chart: skeleton

### Lesson 21.1 — `Chart.yaml`, values and helpers

⏱ ~30 min — **Goal:** Every tunable in one place, and nothing secret in it

> 🧠 **Intuition — values vs secrets**
> `values.yaml` is the **public settings panel**: replicas, hostnames, timeouts, image tags. You'd happily commit it and show it on screen. Secrets are **referenced by name** (`platform-secrets`) and created separately by a script. If someone reads your chart repo, they learn how it's built, not how to get in.

**Step 1.** Create `charts/platform/Chart.yaml`:

```yaml
apiVersion: v2
name: platform
description: Urumi MCP gateway platform (gateway, dashboard, MCP upstreams, Postgres)
type: application
version: 0.1.0
appVersion: "1.0.0"
```

**Step 2.** Create `charts/platform/values.yaml`:

```yaml
# charts/platform/values.yaml: defaults. NO secrets here, ever.

images:
  registry: urumi            # local: images imported into k3d. Prod: ghcr.io/<you>/urumi
  tag: dev                   # overridden on every deploy with a unique tag
  pullPolicy: IfNotPresent
  pullSecrets: []            # e.g. [ghcr-pull] in prod

ingress:
  enabled: true
  className: traefik
  host: gateway.localhost
  tls:
    enabled: false
    secretName: gateway-tls
    clusterIssuer: ""        # e.g. letsencrypt-prod (cert-manager)

secrets:
  # Created by scripts/create-platform-secrets.ps1, never by Helm.
  # Keys: POSTGRES_PASSWORD, GATEWAY_ENCRYPTION_KEY, ADMIN_PASSWORD, WOO_MCP_TOKEN, UTILS_MCP_API_KEY, LLM_API_KEY
  platform: platform-secrets
  # The WooCommerce adapter's own settings (store URL, consumer key/secret).
  wooMcpEnv: woo-mcp-env

gateway:
  replicas: 1
  port: 3000
  publicUrl: http://gateway.localhost:8080   # used to build invite links
  adminEmail: admin@urumi.local
  timezone: Asia/Kolkata
  callTimeoutMs: 15000
  listTimeoutMs: 4000
  healthIntervalMs: 15000
  llm:
    baseUrl: https://api.groq.com/openai/v1
    model: llama-3.3-70b-versatile
  extraSeeds: []             # e.g. [{slug: deepwiki, name: DeepWiki, url: "https://mcp.deepwiki.com/mcp", authType: none}]
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 384Mi }

postgres:
  image: postgres:16-alpine
  storageClass: local-path
  size: 1Gi
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }

dashboard:
  replicas: 1
  port: 8080
  resources:
    requests: { cpu: 20m, memory: 32Mi }
    limits: { cpu: 200m, memory: 96Mi }

wooMcp:
  enabled: true
  port: 3001
  tokenEnvName: MCP_AUTH_TOKEN   # the env var YOUR adapter reads its bearer token from
  forwardedProto: https          # sets WOO_FORWARDED_PROTO (Phase 20)
  env: {}                        # extra non-secret env for the adapter, name: value
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits: { cpu: 300m, memory: 256Mi }

utilsMcp:
  enabled: true
  port: 3002
  resources:
    requests: { cpu: 20m, memory: 64Mi }
    limits: { cpu: 200m, memory: 128Mi }

everythingMcp:
  enabled: true
  port: 3001
  resources:
    requests: { cpu: 20m, memory: 96Mi }
    limits: { cpu: 300m, memory: 256Mi }

networkPolicies:
  enabled: true
  ingressControllerNamespace: kube-system   # where Traefik runs in k3s
  extraIngressCidrs: []                     # e.g. the node CIDR if probes get blocked
```

> ⚠️ **Heads up**
> Set `wooMcp.tokenEnvName` to the **actual** env var name your adapter reads (look in its `.env.example`). Part 1 used `MCP_AUTH_TOKEN` as an example.

**Step 3.** Create `charts/platform/templates/_helpers.tpl`:

```yaml
{{/* Selector labels: stable, used by Services and NetworkPolicies */}}
{{- define "platform.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/* Full labels */}}
{{- define "platform.labels" -}}
{{ include "platform.selector" . }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/part-of: urumi-platform
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version }}
{{- end }}

{{/* Image reference: <registry>/<name>:<tag> */}}
{{- define "platform.image" -}}
{{ printf "%s/%s:%s" .root.Values.images.registry .name .root.Values.images.tag }}
{{- end }}

{{/* Hardened container defaults */}}
{{- define "platform.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{/* Pod-level defaults for non-root images (uid must be numeric for runAsNonRoot to verify) */}}
{{- define "platform.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{- define "platform.pullSecrets" -}}
{{- with .Values.images.pullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/* Fully-qualified in-cluster DNS name for a Service in this release's namespace */}}
{{- define "platform.fqdn" -}}
{{ printf "%s.%s.svc.cluster.local" .name .root.Release.Namespace }}
{{- end }}
```

**Step 4.** Create `charts/platform/values-local.yaml`:

```yaml
# charts/platform/values-local.yaml: k3d on your laptop
images:
  registry: urumi
  pullPolicy: IfNotPresent
ingress:
  host: gateway.localhost
  tls:
    enabled: false
gateway:
  publicUrl: http://gateway.localhost:8080
wooMcp:
  tokenEnvName: MCP_AUTH_TOKEN   # ← change to your adapter's variable name
```

**Step 5.** Create `charts/platform/values-prod.yaml` (used in Phase 26):

```yaml
# charts/platform/values-prod.yaml: single-node k3s on a VPS
images:
  registry: ghcr.io/<your-github-user>/urumi
  pullSecrets: [ghcr-pull]
ingress:
  host: gateway.<your-domain>
  tls:
    enabled: true
    secretName: gateway-tls
    clusterIssuer: letsencrypt-prod
gateway:
  replicas: 2
  publicUrl: https://gateway.<your-domain>
```

> 💡 **What just happened?**
> Local vs prod differ **only in values**: registry, hostname, TLS, replicas. Same templates, same images. That's the "local-to-VPS story" the brief asks about, in one sentence.

---

# PHASE 22
## Workload templates

### Lesson 22.1 — Postgres: StatefulSet + PVC + Service

⏱ ~20 min — **Goal:** Gateway data survives pod deletion

> 🧠 **Intuition — why a StatefulSet?**
> A Deployment's pods are interchangeable cattle with no fixed identity. A database needs a **named** pod (`gateway-postgres-0`) that always reattaches to **its own disk**. `volumeClaimTemplates` creates that disk (a PVC) once, and it outlives every pod restart and even `helm uninstall` (PVCs from StatefulSets aren't deleted automatically, a deliberate safety net).

Create `charts/platform/templates/postgres.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: gateway-postgres
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "gateway-postgres" "component" "database") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "gateway-postgres") | nindent 4 }}
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: gateway-postgres
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "gateway-postgres" "component" "database") | nindent 4 }}
spec:
  serviceName: gateway-postgres
  replicas: 1
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "gateway-postgres") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "gateway-postgres" "component" "database") | nindent 8 }}
    spec:
      # The official image starts as root only to fix data-dir ownership, then drops to uid 70 (postgres).
      securityContext:
        fsGroup: 70
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: postgres
          image: {{ .Values.postgres.image }}
          imagePullPolicy: IfNotPresent
          ports:
            - name: postgres
              containerPort: 5432
          env:
            - name: POSTGRES_USER
              value: gateway
            - name: POSTGRES_DB
              value: gateway
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.secrets.platform }}
                  key: POSTGRES_PASSWORD
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "gateway", "-d", "gateway"]
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "gateway", "-d", "gateway"]
            initialDelaySeconds: 30
            periodSeconds: 15
            failureThreshold: 4
          resources:
            {{- toYaml .Values.postgres.resources | nindent 12 }}
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: {{ .Values.postgres.storageClass }}
        resources:
          requests:
            storage: {{ .Values.postgres.size }}
```

> ⚠️ **Heads up**
> - `PGDATA` points to a **subdirectory** of the mount. A fresh volume can contain `lost+found`, and Postgres refuses to init a non-empty directory.
> - `POSTGRES_PASSWORD` only takes effect on the **first** init of the volume. If you rotate it later, Postgres keeps the old one. Never rotate it casually (the secrets script persists it for exactly this reason).

---

### Lesson 22.2 — Gateway Deployment + Service

⏱ ~30 min — **Goal:** All config from values, all secrets from the Secret, with startup/readiness/liveness probes

Create `charts/platform/templates/gateway.yaml`:

```yaml
{{- $ns := .Release.Namespace -}}
{{- $seeds := list -}}
{{- $allow := list -}}
{{- if .Values.wooMcp.enabled }}
{{- $host := include "platform.fqdn" (dict "root" $ "name" "woo-mcp") }}
{{- $allow = append $allow $host }}
{{- $seeds = append $seeds (dict "slug" "woo" "name" "WooCommerce Store" "url" (printf "http://%s:%v/mcp" $host .Values.wooMcp.port) "authType" "bearer" "secretEnv" "WOO_MCP_TOKEN") }}
{{- end }}
{{- if .Values.utilsMcp.enabled }}
{{- $host := include "platform.fqdn" (dict "root" $ "name" "utils-mcp") }}
{{- $allow = append $allow $host }}
{{- $seeds = append $seeds (dict "slug" "utils" "name" "Utilities" "url" (printf "http://%s:%v/mcp" $host .Values.utilsMcp.port) "authType" "header" "headerName" "X-Api-Key" "secretEnv" "UTILS_MCP_API_KEY") }}
{{- end }}
{{- if .Values.everythingMcp.enabled }}
{{- $host := include "platform.fqdn" (dict "root" $ "name" "everything-mcp") }}
{{- $allow = append $allow $host }}
{{- $seeds = append $seeds (dict "slug" "everything" "name" "Everything (reference)" "url" (printf "http://%s:%v/mcp" $host .Values.everythingMcp.port) "authType" "none") }}
{{- end }}
{{- range .Values.gateway.extraSeeds }}
{{- $seeds = append $seeds . }}
{{- end }}
apiVersion: v1
kind: Service
metadata:
  name: gateway
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "gateway" "component" "gateway") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "gateway") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.gateway.port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "gateway" "component" "gateway") | nindent 4 }}
spec:
  replicas: {{ .Values.gateway.replicas }}
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "gateway") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "gateway" "component" "gateway") | nindent 8 }}
    spec:
      {{- include "platform.pullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "platform.podSecurity" (dict "uid" 1000) | nindent 8 }}
      containers:
        - name: gateway
          image: {{ include "platform.image" (dict "root" $ "name" "gateway") }}
          imagePullPolicy: {{ .Values.images.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.gateway.port }}
          env:
            - name: PORT
              value: {{ .Values.gateway.port | quote }}
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: POSTGRES_PASSWORD }
            # $(VAR) is expanded by Kubernetes from the env var defined above.
            - name: DATABASE_URL
              value: "postgres://gateway:$(POSTGRES_PASSWORD)@gateway-postgres:5432/gateway"
            - name: GATEWAY_ENCRYPTION_KEY
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: GATEWAY_ENCRYPTION_KEY }
            - name: ADMIN_EMAIL
              value: {{ .Values.gateway.adminEmail | quote }}
            - name: ADMIN_PASSWORD
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: ADMIN_PASSWORD }
            - name: PUBLIC_URL
              value: {{ .Values.gateway.publicUrl | quote }}
            - name: TIMEZONE
              value: {{ .Values.gateway.timezone | quote }}
            - name: CALL_TIMEOUT_MS
              value: {{ .Values.gateway.callTimeoutMs | quote }}
            - name: LIST_TIMEOUT_MS
              value: {{ .Values.gateway.listTimeoutMs | quote }}
            - name: HEALTH_INTERVAL_MS
              value: {{ .Values.gateway.healthIntervalMs | quote }}
            - name: ALLOW_PRIVATE_UPSTREAMS
              value: "false"
            - name: UPSTREAM_ALLOW_HOSTS
              value: {{ join "," $allow | quote }}
            - name: SEED_UPSTREAMS
              value: {{ $seeds | toJson | quote }}
            - name: WOO_MCP_TOKEN
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: WOO_MCP_TOKEN }
            - name: UTILS_MCP_API_KEY
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: UTILS_MCP_API_KEY }
            - name: LLM_BASE_URL
              value: {{ .Values.gateway.llm.baseUrl | quote }}
            - name: LLM_MODEL
              value: {{ .Values.gateway.llm.model | quote }}
            - name: LLM_API_KEY
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: LLM_API_KEY, optional: true }
          startupProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 3
            failureThreshold: 40      # up to ~2 min: covers waiting for Postgres on first install
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: /healthz, port: http }   # never the DB: a DB blip must not restart us
            periodSeconds: 15
            failureThreshold: 4
          resources:
            {{- toYaml .Values.gateway.resources | nindent 12 }}
          securityContext:
            {{- include "platform.containerSecurity" . | nindent 12 }}
```

> 🎤 **Interview angle — "Why does liveness not check the database?"**
> "Liveness answers 'is this process hopelessly stuck? Then kill it.' If Postgres has a 30-second blip and liveness checked the DB, Kubernetes would restart every gateway pod at once, turning a small outage into a big one, with no benefit since a restart doesn't fix Postgres. Readiness checks the DB instead, so pods stop receiving traffic while it's down and resume automatically."

> 💡 **What just happened?**
> - `SEED_UPSTREAMS` is built by the template from what's enabled, so `--set everythingMcp.enabled=false` removes it from both seeds and the allowlist.
> - `UPSTREAM_ALLOW_HOSTS` is the SSRF allowlist: only these three internal names are permitted, while `ALLOW_PRIVATE_UPSTREAMS` stays `false`. An admin typing `gateway-postgres.urumi-platform.svc.cluster.local` in the dashboard is rejected.
> - Seeds are applied **once ever** (Part 2's `bootstrap_state`). After first install, the database is the source of truth and the dashboard manages servers.

---

### Lesson 22.3 — Dashboard Deployment + Service

⏱ ~10 min

Create `charts/platform/templates/dashboard.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: dashboard
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "dashboard" "component" "dashboard") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "dashboard") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.dashboard.port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "dashboard" "component" "dashboard") | nindent 4 }}
spec:
  replicas: {{ .Values.dashboard.replicas }}
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "dashboard") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "dashboard" "component" "dashboard") | nindent 8 }}
    spec:
      {{- include "platform.pullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "platform.podSecurity" (dict "uid" 101) | nindent 8 }}
      containers:
        - name: dashboard
          image: {{ include "platform.image" (dict "root" $ "name" "dashboard") }}
          imagePullPolicy: {{ .Values.images.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.dashboard.port }}
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 20
          resources:
            {{- toYaml .Values.dashboard.resources | nindent 12 }}
          securityContext:
            {{- include "platform.containerSecurity" . | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp      # nginx-unprivileged writes its pid and temp files here
      volumes:
        - name: tmp
          emptyDir: {}
```

---

### Lesson 22.4 — The three MCP upstreams

⏱ ~25 min — **Goal:** Internal-only Services labelled `component: mcp-upstream` (the NetworkPolicy hook)

Create `charts/platform/templates/woo-mcp.yaml`:

```yaml
{{- if .Values.wooMcp.enabled }}
{{- $svc := "woo-mcp" -}}
{{- $port := .Values.wooMcp.port -}}
{{- $fqdn := include "platform.fqdn" (dict "root" $ "name" $svc) -}}
{{- $hosts := list $svc (printf "%s.%s" $svc .Release.Namespace) (printf "%s.%s.svc" $svc .Release.Namespace) $fqdn -}}
{{- $allowed := list -}}
{{- range $hosts }}
{{- $allowed = append $allowed . }}
{{- $allowed = append $allowed (printf "%s:%v" . $port) }}
{{- end }}
apiVersion: v1
kind: Service
metadata:
  name: woo-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "woo-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "woo-mcp") | nindent 4 }}
  ports:
    - name: http
      port: {{ $port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: woo-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "woo-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "woo-mcp") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "woo-mcp" "component" "mcp-upstream") | nindent 8 }}
    spec:
      {{- include "platform.pullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "platform.podSecurity" (dict "uid" 1000) | nindent 8 }}
      containers:
        - name: woo-mcp
          image: {{ include "platform.image" (dict "root" $ "name" "woo-mcp") }}
          imagePullPolicy: {{ .Values.images.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ $port }}
          envFrom:
            - secretRef:
                name: {{ .Values.secrets.wooMcpEnv }}
          env:
            # Explicit env entries override envFrom on name clashes.
            - name: HOST
              value: "0.0.0.0"
            - name: PORT
              value: {{ $port | quote }}
            - name: MCP_ALLOWED_HOSTS
              value: {{ join "," $allowed | quote }}
            - name: WOO_FORWARDED_PROTO
              value: {{ .Values.wooMcp.forwardedProto | quote }}
            - name: {{ .Values.wooMcp.tokenEnvName }}
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: WOO_MCP_TOKEN }
            {{- range $name, $value := .Values.wooMcp.env }}
            - name: {{ $name }}
              value: {{ $value | quote }}
            {{- end }}
          readinessProbe:
            tcpSocket: { port: http }
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: http }
            periodSeconds: 20
          resources:
            {{- toYaml .Values.wooMcp.resources | nindent 12 }}
          securityContext:
            {{- include "platform.containerSecurity" . | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

Create `charts/platform/templates/utils-mcp.yaml`:

```yaml
{{- if .Values.utilsMcp.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: utils-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "utils-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "utils-mcp") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.utilsMcp.port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: utils-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "utils-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "utils-mcp") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "utils-mcp" "component" "mcp-upstream") | nindent 8 }}
    spec:
      {{- include "platform.pullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "platform.podSecurity" (dict "uid" 1000) | nindent 8 }}
      containers:
        - name: utils-mcp
          image: {{ include "platform.image" (dict "root" $ "name" "utils-mcp") }}
          imagePullPolicy: {{ .Values.images.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.utilsMcp.port }}
          env:
            - name: HOST
              value: "0.0.0.0"
            - name: PORT
              value: {{ .Values.utilsMcp.port | quote }}
            - name: UTILS_MCP_API_KEY
              valueFrom:
                secretKeyRef: { name: {{ .Values.secrets.platform }}, key: UTILS_MCP_API_KEY }
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 20
          resources:
            {{- toYaml .Values.utilsMcp.resources | nindent 12 }}
          securityContext:
            {{- include "platform.containerSecurity" . | nindent 12 }}
{{- end }}
```

Create `charts/platform/templates/everything-mcp.yaml`:

```yaml
{{- if .Values.everythingMcp.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: everything-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "everything-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "platform.selector" (dict "root" $ "name" "everything-mcp") | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.everythingMcp.port }}
      targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: everything-mcp
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "everything-mcp" "component" "mcp-upstream") | nindent 4 }}
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "everything-mcp") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform.labels" (dict "root" $ "name" "everything-mcp" "component" "mcp-upstream") | nindent 8 }}
    spec:
      {{- include "platform.pullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "platform.podSecurity" (dict "uid" 1000) | nindent 8 }}
      containers:
        - name: everything-mcp
          image: {{ include "platform.image" (dict "root" $ "name" "everything-mcp") }}
          imagePullPolicy: {{ .Values.images.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.everythingMcp.port }}
          env:
            - name: PORT
              value: {{ .Values.everythingMcp.port | quote }}
          readinessProbe:
            tcpSocket: { port: http }
            periodSeconds: 10
          livenessProbe:
            tcpSocket: { port: http }
            periodSeconds: 20
          resources:
            {{- toYaml .Values.everythingMcp.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            # Third-party server: root filesystem left writable in case it writes temp files.
            readOnlyRootFilesystem: false
{{- end }}
```

---

### Lesson 22.5 — Ingress + NOTES

⏱ ~10 min — **Goal:** One public hostname with `/api` and `/mcp` going to the gateway and everything else to the dashboard

Create `charts/platform/templates/ingress.yaml`:

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: platform
  labels:
    {{- include "platform.labels" (dict "root" $ "name" "platform" "component" "ingress") | nindent 4 }}
  {{- if and .Values.ingress.tls.enabled .Values.ingress.tls.clusterIssuer }}
  annotations:
    cert-manager.io/cluster-issuer: {{ .Values.ingress.tls.clusterIssuer }}
  {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts: [{{ .Values.ingress.host | quote }}]
      secretName: {{ .Values.ingress.tls.secretName }}
  {{- end }}
  rules:
    - host: {{ .Values.ingress.host | quote }}
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service: { name: gateway, port: { name: http } }
          - path: /mcp
            pathType: Prefix
            backend:
              service: { name: gateway, port: { name: http } }
          - path: /
            pathType: Prefix
            backend:
              service: { name: dashboard, port: { name: http } }
{{- end }}
```

Create `charts/platform/templates/NOTES.txt`:

```
Urumi MCP platform deployed to namespace {{ .Release.Namespace }}.

Dashboard:       {{ .Values.gateway.publicUrl }}
MCP endpoint:    {{ .Values.gateway.publicUrl }}/mcp
Admin email:     {{ .Values.gateway.adminEmail }}
Admin password:  kubectl get secret {{ .Values.secrets.platform }} -n {{ .Release.Namespace }} -o jsonpath="{.data.ADMIN_PASSWORD}"  (base64)

Check pods:      kubectl get pods -n {{ .Release.Namespace }}
Internal only:   woo-mcp, utils-mcp, everything-mcp, gateway-postgres (no Ingress{{ if .Values.networkPolicies.enabled }}, NetworkPolicies enforced{{ end }})
```

> ✅ **Validate — render before you deploy**
> ```powershell
> PS> helm lint charts/platform -f charts/platform/values-local.yaml
> PS> helm template platform charts/platform -n urumi-platform -f charts/platform/values-local.yaml > .local/rendered.yaml
> PS> Select-String -Path .local/rendered.yaml -Pattern "SEED_UPSTREAMS" -Context 0,1
> ```
> `lint` reports 0 failures. The rendered `SEED_UPSTREAMS` is a JSON array with three entries pointing at `*.urumi-platform.svc.cluster.local`. Open `rendered.yaml` and search for anything that looks like a secret value: you'll find only `secretKeyRef`s.

> 🎤 **Interview angle — "How do you guarantee the MCP servers aren't exposed publicly?"**
> "Three layers. First, their Services are `ClusterIP`, with no NodePort or LoadBalancer. Second, the only Ingress routes `/api` and `/mcp` to the gateway and `/` to the dashboard, so there's no route to any upstream. Third, NetworkPolicies default-deny ingress in the namespace and only allow the gateway to reach pods labelled `mcp-upstream`, so even another pod *inside* the cluster can't call them. I can show you that third one failing live."

---

# PHASE 23
## Secrets and deploy scripts

### Lesson 23.1 — `create-platform-secrets.ps1`

⏱ ~25 min — **Goal:** Generate strong secrets once, keep them stable across re-runs, apply them idempotently

> 🧠 **Intuition — why persist generated secrets locally?**
> Two of these values must **never change** after first use: `GATEWAY_ENCRYPTION_KEY` (change it and every stored upstream credential becomes undecryptable) and `POSTGRES_PASSWORD` (Postgres keeps the original). So the script generates them **once**, saves them to the gitignored `.local/platform-secrets.env`, and reuses them on every run. Re-running is safe, and that property is called *idempotent*.

Create `scripts/create-platform-secrets.ps1`:

```powershell
# scripts/create-platform-secrets.ps1
# Creates/updates the Kubernetes Secrets for the platform. Safe to re-run: generated values are
# persisted in .local/platform-secrets.env (gitignored) and reused, never rotated silently.
[CmdletBinding()]
param(
  [string]$Namespace = 'urumi-platform',
  [string]$LlmApiKey = $env:LLM_API_KEY,
  [string]$WooEnvFile = '.local/woo-mcp.k8s.env'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $repoRoot '.local'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

if (-not $env:KUBECONFIG -and (Test-Path (Join-Path $localDir 'kubeconfig'))) {
  $env:KUBECONFIG = Join-Path $localDir 'kubeconfig'
}

function New-RandomBytes([int]$Count) {
  $bytes = New-Object byte[] $Count
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ,$bytes
}
function New-Hex([int]$Count) { -join ((New-RandomBytes $Count) | ForEach-Object { $_.ToString('x2') }) }
function New-Base64([int]$Count) { [Convert]::ToBase64String((New-RandomBytes $Count)) }

function Assert-Native([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

# 1. Load existing values (never regenerate what already exists)
$statePath = Join-Path $localDir 'platform-secrets.env'
$state = [ordered]@{}
if (Test-Path $statePath) {
  foreach ($line in Get-Content $statePath) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $state[$Matches[1]] = $Matches[2] }
  }
}

$generators = [ordered]@{
  POSTGRES_PASSWORD      = { New-Hex 24 }      # hex: safe inside a postgres:// URL
  GATEWAY_ENCRYPTION_KEY = { New-Base64 32 }   # exactly 32 bytes for AES-256
  ADMIN_PASSWORD         = { New-Hex 12 }
  WOO_MCP_TOKEN          = { New-Hex 32 }
  UTILS_MCP_API_KEY      = { New-Hex 32 }
}
foreach ($name in $generators.Keys) {
  if (-not $state[$name]) { $state[$name] = & $generators[$name]; Write-Host "generated $name" }
}
if ($LlmApiKey) { $state['LLM_API_KEY'] = $LlmApiKey }
if (-not $state.Contains('LLM_API_KEY')) { $state['LLM_API_KEY'] = '' }

# 2. Persist (UTF-8 without BOM, which kubectl's env-file parser requires)
$lines = foreach ($key in $state.Keys) { "$key=$($state[$key])" }
[System.IO.File]::WriteAllLines($statePath, [string[]]$lines)

# 3. Namespace + secrets, applied idempotently
kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f - | Out-Null
Assert-Native 'create namespace'

kubectl create secret generic platform-secrets -n $Namespace --from-env-file=$statePath --dry-run=client -o yaml |
  kubectl apply -f - | Out-Null
Assert-Native 'apply platform-secrets'
Write-Host "applied secret platform-secrets in $Namespace"

$wooPath = Join-Path $repoRoot $WooEnvFile
if (Test-Path $wooPath) {
  kubectl create secret generic woo-mcp-env -n $Namespace --from-env-file=$wooPath --dry-run=client -o yaml |
    kubectl apply -f - | Out-Null
  Assert-Native 'apply woo-mcp-env'
  Write-Host "applied secret woo-mcp-env from $WooEnvFile"
} else {
  Write-Warning "$WooEnvFile not found: create it (Part 4, Lesson 20.3) and re-run, or woo-mcp will not start."
}

if (-not $state['LLM_API_KEY']) {
  Write-Warning 'LLM_API_KEY is empty: chat will return 503. Re-run with -LlmApiKey <key> to enable it.'
}
Write-Host ''
Write-Host "Admin login: admin@urumi.local / $($state['ADMIN_PASSWORD'])"
```

> ✅ **Validate**
> ```powershell
> PS> .\scripts\create-platform-secrets.ps1 -LlmApiKey "gsk_..."
> PS> .\scripts\create-platform-secrets.ps1          # run again: nothing is regenerated
> PS> kubectl get secrets -n urumi-platform
> PS> git status --short .local                      # nothing: it's gitignored
> ```
> Two secrets exist. The second run prints no "generated" lines and the same admin password.

> ⚠️ **Heads up**
> - The env file must have **no BOM**. If kubectl complains about an invalid key on line 1, a BOM crept in (e.g. you edited the file in an editor that adds one). Re-save it as "UTF-8" without BOM.
> - `.local/platform-secrets.env` is now the **only copy** of your encryption key outside the cluster. Back it up somewhere private (password manager) before recording the demo.

> 🎤 **Interview angle — "How would you do secrets properly in production?"**
> "Here they're Kubernetes Secrets created out-of-band, so Helm and git never see them. In production I'd add encryption at rest for etcd and manage them with External Secrets Operator (pulling from AWS Secrets Manager or Vault), or Sealed Secrets if it must be GitOps. Key rotation for the gateway's encryption key would need a re-encrypt migration: my ciphertext format is versioned (`v1:`) for exactly that reason."

---

### Lesson 23.2 — `deploy-platform.ps1`: build, import, install

⏱ ~20 min — **Goal:** One command from code change to running pods

> 🧠 **Intuition — why a fresh tag every deploy?**
> If you rebuild `urumi/gateway:dev` and import it again, Kubernetes sees the **same** image name in the pod spec, so nothing changes and nothing restarts. A unique tag (timestamp) changes the spec, which triggers a rolling update, and `helm rollback` can return to an exact previous image.

Create `scripts/deploy-platform.ps1`:

```powershell
# scripts/deploy-platform.ps1
# Builds all platform images, imports them into k3d, and installs/upgrades the Helm release.
[CmdletBinding()]
param(
  [string]$Tag = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$Namespace = 'urumi-platform',
  [string]$Cluster,
  [string[]]$Only,                 # e.g. -Only gateway,dashboard to rebuild a subset
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:KUBECONFIG -and (Test-Path (Join-Path $repoRoot '.local/kubeconfig'))) {
  $env:KUBECONFIG = Join-Path $repoRoot '.local/kubeconfig'
}
function Assert-Native([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

if (-not $Cluster) {
  $clusters = k3d cluster list -o json | ConvertFrom-Json
  Assert-Native 'k3d cluster list'
  if (-not $clusters) { throw 'No k3d cluster found. Run scripts/create-local-cluster.ps1 first.' }
  $Cluster = @($clusters)[0].name
}
Write-Host "cluster: $Cluster   tag: $Tag"

$images = @(
  @{ Name = 'gateway';        Context = 'gateway' },
  @{ Name = 'dashboard';      Context = 'dashboard' },
  @{ Name = 'woo-mcp';        Context = '.' },
  @{ Name = 'utils-mcp';      Context = 'mcp-servers/utils' },
  @{ Name = 'everything-mcp'; Context = 'mcp-servers/everything' }
)
if ($Only) { $images = $images | Where-Object { $Only -contains $_.Name } }

if (-not $SkipBuild) {
  foreach ($image in $images) {
    $ref = "urumi/$($image.Name):$Tag"
    Write-Host "building $ref"
    docker build -t $ref (Join-Path $repoRoot $image.Context)
    Assert-Native "docker build $ref"
  }
  $refs = $images | ForEach-Object { "urumi/$($_.Name):$Tag" }
  k3d image import -c $Cluster @refs
  Assert-Native 'k3d image import'
}

$helmArgs = @(
  'upgrade', '--install', 'platform', (Join-Path $repoRoot 'charts/platform'),
  '-n', $Namespace, '--create-namespace',
  '-f', (Join-Path $repoRoot 'charts/platform/values-local.yaml'),
  '--set', "images.tag=$Tag",
  '--wait', '--timeout', '6m'
)
helm @helmArgs
Assert-Native 'helm upgrade'
kubectl get pods -n $Namespace
```

> ⚠️ **Heads up — `-Only` and tags**
> With `-Only gateway`, only the gateway gets a new image, but `images.tag` applies to **all** workloads, and the others don't have that tag in k3d (ImagePullBackOff). For partial rebuilds, either re-tag the other images too (`docker tag urumi/x:<old> urumi/x:<new>` and import), or simply run the full deploy (it's ~2–4 minutes). Simplest for the deadline: **always run the full deploy**.

> 🤖 **Codex prompt — reuse the existing cluster finder**
> ```
> scripts/lib/find-k3d-cluster.ps1 already finds the k3d cluster used by this repo. Update
> scripts/deploy-platform.ps1 to use it instead of picking the first cluster from `k3d cluster list`,
> keeping the -Cluster parameter as an override. Don't change anything else.
> ```

---

# PHASE 24
## NetworkPolicies

### Lesson 24.1 — Default deny + explicit allows

⏱ ~25 min — **Goal:** Inside `urumi-platform`, only the paths in the architecture diagram are possible

> 🧠 **Intuition — the office building with keycards**
> Default deny = every door locked. Then you issue specific keycards:
> - the **front desk** (Traefik in `kube-system`) can open the **lobby doors** (gateway, dashboard);
> - the **concierge** (gateway) can open the **back offices** (MCP servers) and the **records room** (Postgres);
> - nobody else can open anything.
>
> A visitor who sneaks into the building (a rogue pod) finds every door locked.

| From → To | gateway | dashboard | MCP upstreams | Postgres |
| --- | --- | --- | --- | --- |
| Traefik (kube-system) | ✅ | ✅ | ❌ | ❌ |
| gateway | — | ❌ | ✅ | ✅ |
| any other pod | ❌ | ❌ | ❌ | ❌ |

Create `charts/platform/templates/networkpolicies.yaml`:

```yaml
{{- if .Values.networkPolicies.enabled }}
# 1. Lock every door: no ingress to any pod in this namespace unless allowed below.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
---
# 2. The ingress controller may reach the two public workloads.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-controller
spec:
  podSelector:
    matchExpressions:
      - key: app.kubernetes.io/name
        operator: In
        values: ["gateway", "dashboard"]
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ .Values.networkPolicies.ingressControllerNamespace }}
---
# 3. Only the gateway may reach the MCP servers.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-upstreams
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: mcp-upstream
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              {{- include "platform.selector" (dict "root" $ "name" "gateway") | nindent 14 }}
---
# 4. Only the gateway may reach Postgres, and only on 5432.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-postgres
spec:
  podSelector:
    matchLabels:
      {{- include "platform.selector" (dict "root" $ "name" "gateway-postgres") | nindent 6 }}
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              {{- include "platform.selector" (dict "root" $ "name" "gateway") | nindent 14 }}
      ports:
        - protocol: TCP
          port: 5432
{{- with .Values.networkPolicies.extraIngressCidrs }}
---
# 5. Optional: allow node-originated traffic (kubelet probes) if your CNI needs it.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-extra-cidrs
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
  ingress:
    - from:
        {{- range . }}
        - ipBlock:
            cidr: {{ . }}
        {{- end }}
{{- end }}
{{- end }}
```

> 💡 **What just happened?**
> - Policies only restrict **ingress** (who can connect *to* a pod). Replies to allowed connections flow back automatically, because policies are stateful.
> - **Egress is open** on purpose: the gateway must reach the LLM provider on the internet, and woo-mcp must reach WordPress in the `urumi` namespace. Locking down egress (DNS + specific destinations only) is a documented next step.
> - k3s ships a built-in NetworkPolicy controller (kube-router-based), so these are **enforced** on k3d/k3s without installing Calico or Cilium.

> ⚠️ **Heads up — if pods turn NotReady right after enabling policies**
> Kubelet probes come from the node. Most CNIs (including k3s's default) allow node → local pod traffic, but if yours doesn't, probes fail. Find the k3d network CIDR and allow it:
> ```powershell
> PS> docker network inspect k3d-<cluster> --format "{{(index .IPAM.Config 0).Subnet}}"
> ```
> Then set `networkPolicies.extraIngressCidrs: ["172.18.0.0/16"]` (your value) in `values-local.yaml` and redeploy.

---

# PHASE 25
## Deploy and verify

### Lesson 25.1 — First install

⏱ ~30 min — **Goal:** Everything Running and Ready, dashboard reachable at `http://gateway.localhost:8080`

**Step 1.** Make `gateway.localhost` resolvable for **non-browser** tools. Browsers resolve `*.localhost` automatically, but Node (Claude Code, the smoke script) and PowerShell use the OS resolver. Open **Notepad as Administrator** → `C:\Windows\System32\drivers\etc\hosts` → add:

```
127.0.0.1 gateway.localhost
```

(Add `127.0.0.1 store.localhost` too if it isn't already there.)

```powershell
PS> ipconfig /flushdns
PS> Resolve-DnsName gateway.localhost
```

**Step 2.** Check Traefik is where the policy expects it:

```powershell
PS> kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
```

**Step 3.** Secrets (if you haven't already), then deploy:

```powershell
PS> .\scripts\create-platform-secrets.ps1 -LlmApiKey "gsk_..."
PS> .\scripts\deploy-platform.ps1
```

**Step 4.** Watch it come up (in a second terminal, during the deploy):

```powershell
PS> kubectl get pods -n urumi-platform -w
```

> ✅ **Validate**
> ```powershell
> PS> kubectl get pods,svc,ingress,pvc,networkpolicy -n urumi-platform
> PS> kubectl logs -n urumi-platform deploy/gateway | Select-String "bootstrap|listening"
> PS> Invoke-RestMethod http://gateway.localhost:8080/api/auth/me     # 401 = the gateway answered through Traefik
> ```
> - 6 pods `Running` and `1/1 Ready` (gateway, dashboard, woo-mcp, utils-mcp, everything-mcp, gateway-postgres-0).
> - The PVC is `Bound`.
> - 4 NetworkPolicies.
> - Gateway logs show `registered upstream "woo"`, `"utils"`, `"everything"` and `listening on :3000`.
> - `/api/auth/me` returns **401** (good: it's the gateway refusing an unauthenticated call, through the Ingress).
>
> Open `http://gateway.localhost:8080` and log in as `admin@urumi.local` with the password the secrets script printed. Servers shows **three green cards**.

> ⚠️ **Heads up — Kubernetes troubleshooting table**
>
> | Symptom | Diagnose with | Usual cause → fix |
> | --- | --- | --- |
> | `ImagePullBackOff` / `ErrImageNeverPull` | `kubectl describe pod <p>` (Events) | Image not imported or tag mismatch → re-run the deploy script. Check `images.registry` is `urumi` locally |
> | `CrashLoopBackOff` on gateway | `kubectl logs deploy/gateway --previous` | `Missing required environment variable …` → secret key missing. `GATEWAY_ENCRYPTION_KEY must be 32 …` → bad key |
> | `CreateContainerConfigError` | `kubectl describe pod` | A referenced Secret or key doesn't exist → run the secrets script. `woo-mcp-env` missing → create `.local/woo-mcp.k8s.env` |
> | `container has runAsNonRoot and image has non-numeric user` | Events | `runAsUser` missing → the helpers set it. Check you included `platform.podSecurity` with a `uid` |
> | gateway-postgres `Pending` | `kubectl describe pvc -n urumi-platform` | Wrong storage class → `kubectl get storageclass` (k3d: `local-path`) |
> | Browser gets Traefik `404` | `kubectl get ingress -n urumi-platform` | Host mismatch (`gateway.localhost`) or `ingressClassName` wrong |
> | `502 Bad Gateway` / `no available server` | `kubectl get endpoints -n urumi-platform` | Pod not Ready (probe failing) or port name mismatch |
> | woo **Unreachable**: "rejected … (401)" | `kubectl logs deploy/woo-mcp` | `tokenEnvName` doesn't match your adapter's variable → fix values-local and redeploy |
> | woo **Unreachable**: Host / "Invalid Host" error | woo-mcp logs | `MCP_ALLOWED_HOSTS` not implemented or not read → recheck Phase 20 |
> | woo **Unreachable**: ECONNREFUSED | woo-mcp logs | The adapter still binds `127.0.0.1` → it must read `HOST` |
> | woo Connected but tools error with 401 from WooCommerce | woo-mcp logs | `X-Forwarded-Proto` not sent → recheck Lesson 20.2/20.3 |
> | everything **Unreachable**: 403 / Host rejected | everything-mcp logs | The reference server validates Host → time-box, then disable it and seed DeepWiki via `gateway.extraSeeds` |
> | All pods NotReady after policies | `kubectl describe pod` (probe failures) | See Phase 24's heads-up → `extraIngressCidrs` |
> | `UPGRADE FAILED: another operation … in progress` | `helm history platform -n urumi-platform` | A previous run was interrupted → `helm rollback platform <last-good-rev> -n urumi-platform` |
> | Changed a seed in values, nothing happened | — | By design: seeds apply once. Change servers in the dashboard |
> | `Unsupported state or unable to authenticate data` in logs | gateway logs | The encryption key changed → restore the old value from `.local/platform-secrets.env`. **Never rotate it casually** |

---

### Lesson 25.2 — End-to-end through the Ingress

⏱ ~30 min — **Goal:** Re-run the Part 3 rehearsal against the cluster, the way evaluators will

**Step 1.** Dashboard: invite user B, open the link in an incognito window, accept, and create a key named `claude-code` (all in the browser, at `http://gateway.localhost:8080`).

**Step 2.** Smoke script against the cluster:

```powershell
PS> cd gateway
PS> $env:GATEWAY_URL = "http://gateway.localhost:8080/mcp"; $env:GATEWAY_KEY = "mcpk_..."
PS> npm run smoke -- utils__convert_currency amount=1000 from=INR to=EUR
```

**Step 3.** Claude Code against the cluster:

```powershell
PS> claude mcp remove urumi        # if you added the local one in Part 2
PS> claude mcp add --transport http urumi http://gateway.localhost:8080/mcp --header "Authorization: Bearer mcpk_..."
PS> claude
> /mcp
> What orders came in today, and what's their total in EUR?
```

**Step 4.** Dashboard Chat as user B: same question, with the trace chips visible.

> ✅ **Validate**
> The admin's Audit page shows user B's calls via `mcp` and `chat`, with server, tool, duration and outcome. **That's the core definition of done, in the cluster.**

---

### Lesson 25.3 — Prove "internal is internal"

⏱ ~15 min — **Goal:** A live, repeatable proof for the video

```powershell
# A random pod in the same namespace: BLOCKED (times out)
PS> kubectl run np-test -n urumi-platform --rm -it --restart=Never --image=curlimages/curl -- curl -sS -m 5 http://utils-mcp:3002/healthz

# The gateway pod: ALLOWED
PS> kubectl exec -n urumi-platform deploy/gateway -- wget -qO- -T 5 http://utils-mcp:3002/healthz

# Postgres from a random pod: BLOCKED
PS> kubectl run np-test2 -n urumi-platform --rm -it --restart=Never --image=busybox:1.36 -- nc -zv -w 5 gateway-postgres 5432

# No public route to upstreams: Traefik has nothing for them
PS> Invoke-WebRequest http://gateway.localhost:8080/healthz -SkipHttpErrorCheck | Select-Object StatusCode   # served by the dashboard SPA, not utils
```

> ✅ **Validate**
> The first command fails with `curl: (28) Connection timed out`. The second prints `{"status":"ok"}`. The third times out.
>
> (`-SkipHttpErrorCheck` needs PowerShell 7. On Windows PowerShell 5.1 use `try { Invoke-WebRequest … } catch { $_.Exception.Response.StatusCode }`.)

> 💡 **What just happened?**
> Same namespace, same port, same URL, but different results depending on **who** is asking. That's the NetworkPolicy doing its job, and it's the clearest 20 seconds of your demo video.

---

### Lesson 25.4 — Failure demos in the cluster

⏱ ~20 min — **Goal:** Rehearse the resilience part of the video with real Kubernetes actions

**A. An upstream dies (and the rest keeps working):**

```powershell
PS> kubectl scale deploy/utils-mcp -n urumi-platform --replicas=0
```

Within ~15 s, the dashboard shows Utilities **Unreachable** ("… unreachable (ECONNREFUSED)" or a timeout). Claude Code: `woo__list_products` still works, and a currency conversion fails with a message naming Utilities.

```powershell
PS> kubectl scale deploy/utils-mcp -n urumi-platform --replicas=1
```

It turns green again with no gateway restart. **Self-healing.**

**B. Kubernetes self-healing (pod deleted):**

```powershell
PS> kubectl delete pod -n urumi-platform -l app.kubernetes.io/name=woo-mcp
PS> kubectl get pods -n urumi-platform -w
```

The Deployment replaces it within seconds, and woo goes briefly Unreachable, then Connected.

**C. Slow upstream (timeout):** in Chat or Claude Code, "Call `utils__sleep` with 25 seconds." It fails after 15 s with "did not respond within 15s", while other tools keep answering.

**D. Gateway restart (stateless + persistent data):**

```powershell
PS> kubectl rollout restart deploy/gateway -n urumi-platform
PS> kubectl delete pod -n urumi-platform gateway-postgres-0
```

After both come back: the same keys still work in Claude Code, the audit history is intact, and upstreams are still registered. The data lives on the PVC, and the gateway holds no session state.

**E. Revocation:** admin → Members → B → Keys → Revoke. Claude Code's next tool call fails with 401, and the Audit page shows a **denied** row for B.

> ✅ **Validate — Part 4 checkpoint**
> A–E all behave as described. **Commit and tag:**
> ```powershell
> PS> git add -A; git commit -m "platform helm chart, images, network policies"
> PS> git tag checkpoint-cluster-complete
> ```

---

# PHASE 26
## Operations: upgrade, rollback, VPS, store bootstrap

### Lesson 26.1 — Upgrade and rollback

⏱ ~15 min — **Goal:** Be able to say *and show* how a bad release is undone

```powershell
PS> helm history platform -n urumi-platform
PS> .\scripts\deploy-platform.ps1                 # every deploy = new revision with a new image tag
PS> helm rollback platform <previous-revision> -n urumi-platform --wait
PS> kubectl rollout status deploy/gateway -n urumi-platform
```

> 🎤 **Interview angle — "How do upgrades and rollbacks work, including the database?"**
> "Each deploy is a Helm revision pinned to unique image tags, so `helm rollback` returns to exact previous images. Kubernetes does a rolling update, and readiness gates traffic so there's no downtime with 2+ replicas. For the schema, migrations are additive only (`CREATE … IF NOT EXISTS`, new nullable columns), so the previous code version still works against the newer schema, which makes rollback safe. A destructive change would be split into expand → migrate → contract across releases. For the **store**, before a WordPress or WooCommerce upgrade I take a `mysqldump` and snapshot the volumes, because plugin upgrades run their own DB migrations and those aren't reversible by `helm rollback`."

Store backup command (adapt the pod and secret names from `kubectl get pods,secrets -n urumi`):

```powershell
PS> kubectl exec -n urumi <mysql-pod> -- sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --all-databases' > .local/store-backup.sql
```

---

### Lesson 26.2 — The VPS path (k3s): explain it even if you don't do it

⏱ ~15 min to read · 2–3 h to do. **Only if Sunday allows.**

| Step | Local (k3d) | VPS (k3s) |
| --- | --- | --- |
| Cluster | `create-local-cluster.ps1` | `curl -sfL https://get.k3s.io \| sh -` (Traefik, local-path and the NetworkPolicy controller included) |
| Images | `k3d image import` | Build in CI (or locally), push to GHCR: `docker push ghcr.io/<you>/urumi/gateway:<tag>` |
| Pulling | Already on the node | `kubectl create secret docker-registry ghcr-pull --docker-server=ghcr.io --docker-username=<you> --docker-password=<PAT with read:packages> -n urumi-platform` |
| DNS | hosts file `*.localhost` | A records `gateway.<domain>` and `store.<domain>` → VPS IP |
| TLS | HTTP (or local CA) | cert-manager + Let's Encrypt `ClusterIssuer` (HTTP-01 via Traefik) |
| Values | `values-local.yaml` | `values-prod.yaml` |
| Secrets | `create-platform-secrets.ps1` | Same script against the VPS kubeconfig (or External Secrets) |
| Firewall | n/a | Open only 22 (restricted), 80 and 443. Never expose 6443 publicly |

cert-manager `ClusterIssuer` (applied once):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: you@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-account
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

Deploy:

```bash
helm upgrade --install platform charts/platform -n urumi-platform \
  -f charts/platform/values-prod.yaml --set images.tag=<tag> --wait
```

> 🎤 **Interview angle — "What changes from local to production?"**
> "Only values and the supply chain: images come from a registry instead of being imported, DNS and Let's Encrypt replace `*.localhost`, and replicas go up. Templates, images and code are identical. On a single VPS, the honest risks are that the node is a single point of failure and local-path storage lives on one disk, so I'd add scheduled `pg_dump` and `mysqldump` to object storage, and move to managed Postgres/MySQL or a replicated storage class when it matters."

---

### Lesson 26.3 — Optional: store bootstrap Job (only if time remains)

⏱ ~1.5 h. **Skip this if it's Sunday afternoon.** Your store already works, and the README can describe the manual steps.

The idea: a Helm hook Job in the **store** chart that makes a fresh install reproducible. It installs WooCommerce, enables Cash on Delivery, and creates the REST API key the adapter uses, with key values generated by a script and stored in a Secret so nothing is clicked by hand.

> 🤖 **Codex prompt**
> ```
> In charts/store, add an optional post-install/post-upgrade Helm hook Job (values: bootstrap.enabled,
> default false) using the official wordpress:cli image, running as uid 33 (www-data), mounting the
> same WordPress volume/config as the WordPress Deployment. The Job must be idempotent:
>   1. wait until `wp core is-installed` succeeds (retry up to 5 minutes);
>   2. if WooCommerce isn't active: `wp plugin install woocommerce --version=11.2.1 --activate`
>      (skip install if already present, just activate);
>   3. enable Cash on Delivery: `wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery"}' --format=json`;
>   4. create a WooCommerce REST API key ONLY if none exists with description "urumi-mcp", using
>      `wp eval` to insert into {$wpdb->prefix}woocommerce_api_keys with consumer_key = wc_api_hash($ck),
>      consumer_secret = $cs, truncated_key = substr($ck, -7), permissions = 'read_write', user_id = 1,
>      where $ck/$cs come from env vars sourced from a Kubernetes Secret (woo-api-key) that a script
>      generates (ck_ + 40 hex, cs_ + 40 hex) and stores in .local.
> Never print the key values in logs. Show me the template and how to test it with helm template.
> ```

> 💡 **Why `wp eval` and `wc_api_hash`?**
> WooCommerce stores the consumer **key** hashed (`hash_hmac('sha256', $key, 'wc-api')`, via `wc_api_hash`) and the secret in plain text. Inserting the row directly is how you pre-provision a key that you generated yourself, so the same values can go into the adapter's Secret. It's the same "store a fingerprint, not the key" pattern as your gateway's API keys, so point that out.

---

## End of Part 4 — what you've built

- Five hardened images (non-root, multi-stage, `.dockerignore`d so no `.env`/`.local` can leak).
- An adapter that runs unchanged locally and in-cluster, driven only by env.
- A Helm chart where only values differ between local and prod: probes, resources and security contexts everywhere, Postgres on a PVC, one Ingress, and an SSRF allowlist built from what's enabled.
- Idempotent secret management with stable encryption keys, and a one-command deploy with unique tags for clean rollbacks.
- NetworkPolicies you can **prove** live, plus failure, recovery and revocation demos with real `kubectl` actions.

### If an interviewer asks…

**"Walk me through what happens when you run the deploy script."**
It builds five images with a timestamp tag and imports them into the k3d node. Then `helm upgrade --install` renders the chart with `values-local.yaml` and the new tag, and Kubernetes rolls out the changed Deployments. Readiness probes gate traffic, so old pods serve until new ones are ready. The gateway runs idempotent migrations under an advisory lock, seeds anything not yet seeded, and starts its health loop. `--wait` makes the script fail if anything doesn't become ready within 6 minutes.

**"What's public, what's internal, and how do you know?"**
Public: the dashboard and the gateway's `/api` and `/mcp` via one Traefik Ingress. Internal: the three MCP servers and Postgres, which are ClusterIP with no Ingress, and NetworkPolicies allow only the gateway to reach them. I demonstrate it with a test pod that times out while the gateway pod succeeds on the same URL.

**"Where are the secrets?"**
In two Kubernetes Secrets created by a script, never in Helm values or git: `platform-secrets` (DB password, encryption key, admin password, upstream tokens, LLM key) and `woo-mcp-env` (WooCommerce consumer key and secret). Pods get them as env vars. Upstream credentials are additionally encrypted at rest in Postgres. The browser and MCP clients never receive any of them.

**"What would you change for production?"**
Two+ gateway replicas, a PodDisruptionBudget, egress NetworkPolicies, managed or replicated Postgres with backups, External Secrets, image scanning and signing in CI, rate limiting at the Ingress and per key, and OpenTelemetry tracing across gateway → upstream calls.

When you're ready, open **Part 5**.
