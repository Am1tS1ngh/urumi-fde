# Urumi MCP Gateway: Project Status

| | |
| --- | --- |
| **Branch** | `core-build` |
| **Last verified** | 24 October 2026, on a fresh local k3d cluster |
| **Overall** | Core complete and verified, including chat with a real LLM (Groq `openai/gpt-oss-120b`). |
| **Latest update** | Completion report and document guide added; demo run at scenarios 1–4 of 10 passed (see [Change log](#12-change-log)) |
| **Start here** | [Which document to use](#which-document-to-use) |
| **Published** | Not yet. `core-build` is local only; GitHub has `main` at `fb4091d`. |
| **Related** | [Completion report](COMPLETION.md) · [Scenarios](SCENARIO.md) · [Checklist](CHECKLIST.md) · [Design](DESIGN.md) · [Threat model](THREAT_MODEL.md) · [README](../README.md) |

## Contents

- [Which document to use](#which-document-to-use)

1. [Overview](#1-overview)
2. [Architecture and flow](#2-architecture-and-flow)
3. [Getting started](#3-getting-started)
4. [Operations](#4-operations)
5. [Requirement status](#5-requirement-status)
6. [Technology stack](#6-technology-stack)
7. [Services](#7-services)
8. [Repository layout](#8-repository-layout)
9. [Known limitations](#9-known-limitations)
10. [Troubleshooting](#10-troubleshooting)
11. [Next steps](#11-next-steps)
12. [Change log](#12-change-log)
13. [Environment files](#13-environment-files)

---

## Which document to use

| If you want to… | Use | Best for |
| --- | --- | --- |
| Know whether it's done, what's left, and whether Docker and the cluster are running | [COMPLETION.md](COMPLETION.md) | A one-page snapshot. Read this first. |
| Set it up on another laptop | [COMPLETION.md §7](COMPLETION.md#7-running-on-another-laptop) | What carries over, what to install, commands in order |
| Set up from scratch, start and stop, redeploy, fix an error, see what changed | **STATUS.md** (this file) | Commands and troubleshooting; the source of truth for commands |
| Find the `.env` files and what each setting does | [STATUS.md §13](#13-environment-files) | Templates, generated secrets, and when you need a `.env` |
| Run or record the demo, find a credential, read the audit log, reset test data | [SCENARIO.md](SCENARIO.md) | Click-by-click scenarios and the run log |
| Show a reviewer that each requirement is met | [CHECKLIST.md](CHECKLIST.md) | Requirement-by-requirement ticks with verification notes |
| Understand how it works and why | [DESIGN.md](DESIGN.md) | Request flow, tool naming, failure handling, upgrade and rollback |
| Understand the security reasoning | [THREAT_MODEL.md](THREAT_MODEL.md) | Trust boundaries, risks and mitigations |
| Get a quick overview, develop without Kubernetes, run tests | [README](../README.md) | The repository's front page |
| Learn how it was built, step by step | [course/](course/), [five-tools-guide.md](five-tools-guide.md), [store-foundation.md](store-foundation.md), [local-kubernetes.md](local-kubernetes.md), [live-store-mcp.md](live-store-mcp.md) | Background from 21–22 Oct; parts are out of date |

**Suggested reading paths**

| Who | Order |
| --- | --- |
| You, preparing the demo | COMPLETION → SCENARIO → STATUS (when something breaks) |
| You, on a new laptop | COMPLETION §7 → STATUS §3 and §10 → SCENARIO |
| A reviewer | README → CHECKLIST → DESIGN → THREAT_MODEL |

**If two documents disagree:** trust the current documents (COMPLETION, STATUS, SCENARIO, CHECKLIST,
DESIGN, THREAT_MODEL, README) over the background guides. For commands, STATUS.md wins. For progress and
live status, COMPLETION.md is the newest snapshot.

## 1. Overview

The project gives a team one shared MCP endpoint.

- **Gateway.** Sits in front of three MCP servers (WooCommerce, utilities and the official reference server). It merges their tools, checks each member's own API key, routes every call to the right server and records who called what.
- **Dashboard.** A React app for managing servers, members, keys and the audit log. It includes a chat that uses tools with the signed-in member's permissions.
- **Store.** WordPress with WooCommerce and MySQL. Customers check out here, and the WooCommerce MCP server manages it.
- **Platform.** Everything runs on Kubernetes and is installed with Helm.

## 2. Architecture and flow

```
 Browser ─┐                       ┌─► woo-mcp ───► WordPress + WooCommerce ──► MySQL
          ├─► Ingress ─► gateway ─┼─► utils-mcp
 MCP app ─┘   (Traefik)     │     └─► everything-mcp
                            ├─► PostgreSQL   users, keys, servers, audit log
                            └─► LLM API      chat only
```

**Request lifecycle**

1. **Sign-in.** A person signs in to the dashboard (`/`), which uses the gateway's REST API (`/api`).
2. **Access.** An admin invites members, and each member creates a personal key (`mcpk_…`). Keys are stored only as hashes.
3. **Discovery.** An MCP client calls `/mcp` with its key. `tools/list` returns the tools of every enabled, reachable server, named `<server>__<tool>`.
4. **Routing.** `tools/call` is sent to the server named in the tool, with a 15-second timeout. The result goes back unchanged and one audit record is written.
5. **Chat.** The model chooses tools and the gateway runs them as the signed-in member. The tool trace is shown with the reply.
6. **Health.** Every server is checked every 15 seconds and marked **Connected**, **Unreachable** or **Disabled**. A failing server only loses its own tools.
7. **Isolation.** NetworkPolicies allow only the gateway to reach the MCP servers and PostgreSQL.

## 3. Getting started

> Setting up a second laptop? Start with [COMPLETION.md §7](COMPLETION.md#7-running-on-another-laptop):
> it says what to copy and what to install, then comes back to the steps below.

### Prerequisites

| Requirement | Why | How to get it |
| --- | --- | --- |
| Windows 10/11 with PowerShell | Runs the setup scripts | Built in |
| Docker Desktop (WSL2 engine) | Builds images and hosts the cluster | `winget install Docker.DockerDesktop` |
| kubectl | Talks to the cluster | `winget install Kubernetes.kubectl` |
| Internet access | Images, WooCommerce, k3d and Helm downloads | – |
| Free ports 6550, 8080, 8443 | Cluster API and Ingress | Close anything using them |
| About 10 GB disk, 6 GB RAM | Images and volumes | Docker Desktop → Settings → Resources |

You do not need to install Node.js, k3d or Helm. Images build inside Docker, and the scripts download pinned copies of k3d and Helm.

### Setup order at a glance

```
Docker Desktop  →  tools  →  cluster  →  store  →  platform  →  sign in  →  (optional) chat  →  MCP client
```

Each step depends on the one before it. Do not skip ahead.

### Step-by-step setup

**Step 1. Start Docker Desktop.**
Open Docker Desktop from the Start menu and wait until it shows **Engine running**. Then check it from a terminal:

```powershell
docker info --format '{{.ServerVersion}}'
```

Expected: a version number, such as `29.6.1`. If you get an error, Docker is not ready yet.

**Step 2. Open PowerShell in the repository.**

```powershell
cd C:\path\to\urumi-fde
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

The second line allows the local scripts to run, for this window only. Run every later command from this window.

**Step 3. Download the local tools.** This only needs doing once.

```powershell
.\scripts\install-local-tools.ps1
```

Expected: the script ends by printing the k3d and Helm versions (`v5.9.0`, `v4.3.1`). The files are in `.local\tools`.

**Step 4. Create the Kubernetes cluster.** This takes 1 to 3 minutes.

```powershell
.\scripts\create-local-cluster.ps1
kubectl --kubeconfig .local\kubeconfig get nodes
```

Expected: one node, `k3d-urumi-server-0`, with status `Ready`.

**Step 5. Deploy the store.** This takes 5 to 10 minutes on the first run, because of image downloads.

```powershell
.\scripts\deploy-store-foundation.ps1
kubectl --kubeconfig .local\kubeconfig -n urumi get pods,jobs
```

Expected: `store-mysql` and `store-wordpress` are `1/1 Running`, and job `store-setup` is `Complete`. This step also generates every password into `.local\platform-secrets.env`.

**Step 6. Deploy the platform.** This takes 3 to 5 minutes.

```powershell
.\scripts\deploy-platform.ps1
kubectl --kubeconfig .local\kubeconfig -n urumi-platform get pods
```

Expected: six pods, all `1/1 Running`: `gateway`, `dashboard`, `gateway-postgres-0`, `woo-mcp`, `utils-mcp` and `everything-mcp`.

**Step 7. Get your passwords.**

```powershell
Select-String -Path .local\platform-secrets.env -Pattern '^(ADMIN_PASSWORD|STORE_ADMIN_USER|STORE_ADMIN_PASSWORD)='
```

**Step 8. Sign in to the dashboard.**
Open http://gateway.localhost:8080 and sign in as `admin@urumi.local` with `ADMIN_PASSWORD`.
On **Servers**, all three servers should show **Connected**.

**Step 9. (Optional) Turn on chat.** You need an OpenAI-compatible API key; the default provider is Groq.

```powershell
.\scripts\create-local-secrets.ps1 -LlmApiKey '<your key>'
kubectl --kubeconfig .local\kubeconfig -n urumi-platform rollout restart deployment gateway
```

Reload the **Chat** page. It should name the model instead of saying chat is not configured.

**Step 10. Connect an MCP client.**
On **API keys**, create a key and copy it. It is shown only once. Then point your client at the gateway:

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

Expected: the client lists tools such as `woo__list_orders` and `utils__convert_currency`.

**Step 11. Quick health check.**

```powershell
curl.exe -s http://127.0.0.1:8080/api/auth/me       # {"message":"Please sign in."...} means the gateway is up
curl.exe -s -o NUL -w "%{http_code}" http://store.localhost:8080   # 200 means the store is up
```

### Access summary

| Resource | Address | Credentials |
| --- | --- | --- |
| Dashboard | http://gateway.localhost:8080 | `admin@urumi.local` / `ADMIN_PASSWORD` |
| Store | http://store.localhost:8080 | `STORE_ADMIN_USER` / `STORE_ADMIN_PASSWORD` |
| WordPress admin | http://store.localhost:8080/wp-admin | Same as the store |
| MCP endpoint | http://127.0.0.1:8080/mcp | `Authorization: Bearer <member key>` |

Credentials are generated once and kept in `.local\platform-secrets.env`, which Git ignores. Never commit it.

The **API keys** page shows the URL the dashboard was opened on (`http://gateway.localhost:8080/mcp`).
That works in a browser; external clients on Windows should use `http://127.0.0.1:8080/mcp`.
For a guided tour of every screen, see [SCENARIO.md](SCENARIO.md).

### Starting and stopping later

| When | Do this, in order |
| --- | --- |
| After a reboot | 1. Start Docker Desktop and wait for **Engine running**. 2. `.\scripts\create-local-cluster.ps1` (starts the existing cluster and keeps its data). 3. Wait about a minute, then open the dashboard. |
| Finished for the day | `.\.local\tools\k3d.exe cluster stop urumi`, then quit Docker Desktop if you like. |
| Changed the code | `.\scripts\deploy-platform.ps1`. It rebuilds the images and rolls the pods. |
| Changed store chart values | `.\scripts\deploy-store-foundation.ps1` |

## 4. Operations

For starting, stopping and redeploying, see [Starting and stopping later](#starting-and-stopping-later).

| Task | Command |
| --- | --- |
| Release history | `.\.local\tools\helm.exe --kubeconfig .local\kubeconfig -n urumi-platform history platform` |
| Roll back | `.\.local\tools\helm.exe --kubeconfig .local\kubeconfig -n urumi-platform rollback platform <revision>` |
| Check pods | `kubectl --kubeconfig .local\kubeconfig -n urumi-platform get pods` |
| Gateway logs | `kubectl --kubeconfig .local\kubeconfig -n urumi-platform logs deploy/gateway` |
| Store setup logs | `kubectl --kubeconfig .local\kubeconfig -n urumi logs job/store-setup` |
| Simulate an outage | `kubectl --kubeconfig .local\kubeconfig -n urumi-platform scale deployment everything-mcp --replicas=0` (set back to `1` to recover) |
| Delete everything | `.\.local\tools\k3d.exe cluster delete urumi` (also deletes all data) |

## 5. Requirement status

**Legend:** Done = verified on the cluster · Pending = built, but not yet verified

| Requirement | Status | Evidence |
| --- | --- | --- |
| Store with persistent data | Done | Data survived deleting both store pods |
| Store set up from a fresh deploy | Done | Setup Job; a re-run changes nothing |
| Storefront checkout, order in WooCommerce | Done¹ | Order 12 placed, then read back through the gateway |
| Adapter: five tools over Streamable HTTP | Done | 27/27 tests and live calls |
| Adapter reachable only through the gateway | Done | NetworkPolicy tested from allowed and blocked pods |
| Server management: add, edit, disable, remove | Done | Dashboard and API |
| Upstream credentials: bearer and custom header | Done | `woo` uses bearer, `utils` uses `X-Api-Key` |
| Tool merging, collision rule, routing | Done | `utils__echo` and `everything__echo` both resolve correctly |
| Timeouts and failure isolation | Done | A server taken offline shows Unreachable; other tools keep working |
| Three upstream servers | Done | woo (5 tools), utils (4), everything (22) |
| Dashboard, invitations, admin and member roles | Done | Invite, accept and sign-in flow |
| Hashed member keys with instant revocation | Done | The next call after revoking is refused |
| Audit log and dashboard view | Done | Every call attributed to the right user |
| External MCP client with URL and key only | Done | SDK client through the Ingress |
| Helm, Secrets, probes, limits, storage, Ingress | Done | Both charts deployed; rollback tested |
| Design, threat model, upgrade and rollback docs | Done | See Related links at the top |
| Chat with a real LLM | Done | Groq `openai/gpt-oss-120b`; tool trace shown and audited as `chat` |
| Acceptance step 2: create a product through chat | Done | "Blue Mug" (product 13) created after the chat asked for confirmation |
| Acceptance step 3: read a manual order through chat | Done | Manual order 15 (3 × Blue Mug, ₹1,497) read back through chat |
| Acceptance step 6: one prompt using two servers | Done | User B's external agent: `woo__get_order` → `utils__convert_currency` (€14.63) |

¹ Placed through the WooCommerce Store API, which the checkout page itself calls, not through a browser.
The dashboard was checked with screenshots, and its actions through the API.

## 6. Technology stack

| Layer | Technology |
| --- | --- |
| Language and runtime | TypeScript 7.0.2; Node.js 22.13+ locally, 24.16 in the images |
| Backend framework | NestJS 12.2.0, Zod 4.6.7 |
| MCP | Official TypeScript SDK v2 (server and client 2.3.1, node 2.1.1); Streamable HTTP |
| Gateway database | PostgreSQL 17.7 via `pg` 8.23.1 |
| Frontend | React 19.3.1, Vite 8.3.5, nginx-unprivileged 1.29 |
| LLM | Any OpenAI-compatible API; default Groq `openai/gpt-oss-120b` |
| Store | WordPress 7.1.3 (PHP 8.3), WooCommerce 11.2.1, MySQL 8.4.11, WP-CLI 2.12.0 |
| Orchestration | Kubernetes (k3s 1.35.5 via k3d 5.9.0), Traefik Ingress, local-path storage |
| Packaging | Docker multi-stage images, Helm 4.3.1 |
| Security | scrypt, SHA-256 hashing, AES-256-GCM, SSRF guard, NetworkPolicies, non-root containers |

## 7. Services

| Namespace | Service | Port | Purpose | Storage |
| --- | --- | --- | --- | --- |
| `urumi-platform` | `gateway` | 3000 | MCP endpoint, REST API, routing, audit, chat | – |
| | `dashboard` | 8080 | React web app | – |
| | `gateway-postgres` | 5432 | Gateway database | 2 Gi |
| | `woo-mcp` | 3001 | WooCommerce MCP adapter | – |
| | `utils-mcp` | 3002 | Currency, time, echo, sleep tools | – |
| | `everything-mcp` | 3001 | Official MCP reference server 2.0.0 | – |
| `urumi` | `store-wordpress` | 80 | WordPress and WooCommerce | 1 Gi |
| | `store-mysql` | 3306 | Store database | 2 Gi |
| | `store-setup` (Job) | – | Installs WooCommerce, creates the adapter's API key | – |

## 8. Repository layout

| Path | Contents |
| --- | --- |
| `src/`, `test/` | WooCommerce MCP adapter |
| `gateway/` | Gateway service |
| `dashboard/` | React dashboard |
| `mcp-servers/` | Utilities server and the pinned reference server |
| `charts/store/`, `charts/platform/` | Helm charts |
| `scripts/` | Cluster, secrets and deployment scripts |
| `docs/` | Completion report, status, demo scenarios, checklist, design, threat model and background guides (see [Which document to use](#which-document-to-use)) |

## 9. Known limitations

- **Single gateway replica.** Upstream status and connections are cached in memory.
- **No rate limiting.** Add it at the Ingress before any public deployment.
- **Chat does not stream.** The reply appears once the tool loop finishes.
- **The audit log records who, what and when, but not tool arguments.** This keeps customer data out of the log.
- **Free LLM tiers are tight.** Groq's free tier allows 8,000 tokens a minute, and one chat request with all 31 tools uses about 4,500. The gateway waits and retries when told to (up to 30 s, twice), but a busy minute can still fail.
- **Chat confirms before writing.** The assistant describes a create or update and waits for a "yes" before it runs.

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| First deploy times out | Images are still downloading. Wait, then run the same script again. |
| An MCP client cannot resolve `gateway.localhost` | Use `http://127.0.0.1:8080/mcp`. Node on Windows does not resolve `*.localhost`. |
| A script fails on a harmless warning | Do not redirect script output with `2>&1` or `*>` in Windows PowerShell 5.1. |
| The cluster will not start on WSL2 | `create-local-cluster.ps1` detects cgroup v1 and handles it. Re-run it after Docker is fully up. |
| A server shows Unreachable after recovering | It reconnects within 15 seconds, or press **Check now** on the Servers page. |
| Chat: "The model provider returned 429" | Rate limit. Wait a minute, or disable servers chat doesn't need (the reference server's 22 tools are the largest share). |
| Chat: "model … does not exist" | The provider retired the model. List models with `GET /openai/v1/models` and set `gateway.llm.model`. |
| "WooCommerce request timed out" on the first call after a long idle | WordPress was cold. Check the store before retrying a write; the next calls are fast. |
| Chat answers with a question ("Which order?") | The prompt was too vague. Name the order, product or amount, e.g. "Show order 15". |
| Red rows in the audit log | Read the **Detail** column. `denied` means the gateway refused (revoked key, disabled server, unknown tool); `error` means the upstream failed or timed out. See [SCENARIO.md §6](SCENARIO.md#6-reading-the-audit-log). |

## 11. Next steps

| # | Step | Status |
| --- | --- | --- |
| 1 | Click through every dashboard screen in a browser | Done (Servers, Chat, API keys, Members, Add server, Audit log) |
| 2 | Revoke any key whose full value appeared in a screenshot (the admin's "sample" key) | To do (still active) |
| 3 | Rehearse the demo using [SCENARIO.md](SCENARIO.md) scenarios 1–10 | In progress: 1–4 passed, next is 5 (external client with `demo-b`'s `laptop` key) |
| 3a | Record the demo | To do, after the rehearsal |
| 4 | Rotate the Groq key, run `.\scripts\create-local-secrets.ps1 -LlmApiKey '<new key>'`, restart the gateway | To do |
| 5 | Commit `STATUS.md`, `SCENARIO.md`, `COMPLETION.md` and `CHECKLIST.md`, then push `core-build` | Waiting on author details and branch-or-merge choice |

## 12. Change log

### Latest update: completion report and document guide (24 Oct)

| Type | Change | Why |
| --- | --- | --- |
| Docs | New [COMPLETION.md](COMPLETION.md): mandatory vs bonus status, a live check of Docker and the cluster, a plan to the deadline, and §7 on running on another laptop | One page for "is it done, is it running, how do I move it" |
| Docs | Here: new [Which document to use](#which-document-to-use) section, a pointer to COMPLETION §7 in Getting started, header and next steps | Each document now has one clear job |
| Docs | SCENARIO.md and COMPLETION.md link back to the guide; the README points to it | Readers can find the right document from anywhere |
| Docs | New [§13 Environment files](#13-environment-files): where each `.env` file is, what it holds, and when you need one | There is no `.env` by default, which raised the question |

No code changed.

### Earlier update: demo run, scenarios 1–4 passed (24 Oct)

| Type | Change | Why |
| --- | --- | --- |
| Verified | Scenario 1: storefront order 16 (1 × Sample T-shirt, ₹499, Cash on delivery, Processing) | Customer checkout works without the gateway |
| Verified | Scenario 2: chat created product 18 "Blue Mug" (₹499) after confirmation, 0.8 s | Write through chat; store was warm, so no timeout this time |
| Verified | Scenario 3: manual order 20 (3 × Blue Mug, ₹1,497) read back by chat | Read through chat |
| Verified | Scenario 4: `demo-b@urumi.local` invited, accepted, and created key `laptop` | Invite flow and member keys |
| Finding | Inviting `user-b@urumi.local` again was rejected: "A user with this email already exists." | Expected; members are never deleted. Scenario 4 now says to use a fresh email |
| Docs | SCENARIO.md: progress line, new [Run log](SCENARIO.md#10-run-log), scenarios 5–7 filled in with this run's data (order 20, `demo-b`, key `laptop`), exact Inspector arguments, notes on duplicate product names and draft orders, updated test-data table | Lets the next person continue from scenario 5 |
| Docs | Here: header, next steps and this log | Tracks the run |

Every result was checked in the gateway and store databases, not only on screen. No code changed.

### Earlier update: dashboard reviewed, demo scenarios written (24 Oct)

| Type | Change | Why |
| --- | --- | --- |
| Docs | New [SCENARIO.md](SCENARIO.md): a credentials reference (every sign-in, token and service secret, where it lives and how to read or rotate it), ten demo scenarios, an audit log guide, demo tips, a reset guide and a recording checklist | A repeatable script for the demo recording and for reviewers |
| Docs | Here: header, access summary, troubleshooting, next steps and this log | Points to the scenarios and records what the review found |
| Reviewed | Every dashboard screen and the audit log, in a browser | All three servers Connected with 31 tools; members, keys and chat behave as expected |
| Finding | The red audit rows are deliberate tests: a revoked key, the 15 s `utils__sleep` timeout, the `nope__x` unknown tool, and two 5 s timeouts on a cold store | No code change needed |
| Finding | The API keys page suggests `gateway.localhost` in the client snippet | Documented `127.0.0.1` for Windows clients; no code change |

No code changed in this update.

### Earlier update: chat verified with a real LLM (24 Oct)

| Type | Change | Why |
| --- | --- | --- |
| Fix | Default chat model changed from `llama-3.3-70b-versatile` to `openai/gpt-oss-120b` | Groq retired the old model ("model does not exist") |
| Fix | The gateway waits and retries when the provider answers 429 with a short `Retry-After` (up to 30 s, twice) | Groq's free tier allows 8,000 tokens a minute, and one chat turn makes several model calls |
| Test | New `gateway/test/llm.test.ts`: retries after a short wait; gives up on long or repeated limits | Covers the retry logic (gateway tests: 9/9) |
| Config | Model updated in `charts/platform/values.yaml`, `gateway/.env.example` and the README | Keeps every default in step |
| Ops | Groq key stored with `create-local-secrets.ps1 -LlmApiKey`; gateway restarted | The key lives only in `.local\` and the Kubernetes Secret |
| Verified | Steps 2, 3 and 6 of the acceptance flow, and the real LLM loop | The last 4 checklist items are now ticked |
| Docs | Status table, known limitations, troubleshooting and next steps updated here; checklist ticked | Reflects the results above |

**Data created while testing:** product 13 "Blue Mug", manual order 15 (3 × Blue Mug, ₹1,497) and member `user-b@urumi.local`.

**Seen while testing:** the first store call after hours idle took about 9 s and passed the adapter's 5 s limit. The write still succeeded, and the adapter reported it as unknown instead of retrying.

### Commit history (`core-build`)

| Commit | What it did |
| --- | --- |
| `d1ef9ce` | Make chat work on Groq's current free tier (new model, rate-limit retry) |
| `236edba` | Document the platform (README, design, threat model, checklist) |
| `357555e` | Deploy the gateway, dashboard and MCP servers with Helm (`charts/platform`) |
| `1905e94` | Set up the store from a fresh deploy (setup Job, `create-local-secrets.ps1`) |
| `0ec76d9` | Use a numeric user in the Node images (so Kubernetes can enforce non-root) |
| `bbbca53` | Let the local cluster start on cgroup v1 hosts |
| `d57db34` | Fix tool downloads on Windows PowerShell 5.1 |
| `f78aad5` | Add container images for every service |
| `dd0656c` | Add the team dashboard (React) |
| `0c3664d` | Add a small utilities MCP server |
| `cbe62b2` | Add the MCP gateway service |
| `af9e244` | Let the adapter run inside the cluster |
| `fb4091d` | Starting point: WooCommerce adapter and store chart |

**Not yet committed:** `docs/STATUS.md`, `docs/SCENARIO.md`, `docs/COMPLETION.md` (all new) and `docs/CHECKLIST.md` (ticked items).
**Not yet pushed:** every commit above except `fb4091d`.

## 13. Environment files

There is no `.env` file by default, and the Kubernetes setup doesn't need one. The repo has two
templates; the setup scripts generate the real values in `.local\` and copy them into Kubernetes Secrets.

### Where they are

| File | In the repo? | What it is | Used by |
| --- | --- | --- | --- |
| [`.env.example`](../.env.example) | Yes (committed) | Template for the WooCommerce adapter; values blank | Copy to `.env` to run the adapter outside Kubernetes |
| [`gateway/.env.example`](../gateway/.env.example) | Yes (committed) | Template for the gateway | Copy to `gateway/.env` to run the gateway outside Kubernetes |
| `.env`, `gateway/.env` | No, and Git ignores them | Your filled-in copies of the templates | `npm run dev` / `npm start`, which load them with `--env-file=.env` |
| `.local/platform-secrets.env` | No, and Git ignores it | Real generated values: passwords, tokens, keys | The setup scripts, which turn it into Kubernetes Secrets |
| `.local/store-database.env` | No, and Git ignores it | The store's database passwords | `deploy-store-foundation.ps1` |

### What the templates hold

**`.env.example`: WooCommerce adapter**

| Setting | Meaning |
| --- | --- |
| `WOOCOMMERCE_URL` | The store's base address, not the `/wp-json/...` path |
| `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce REST API key pair |
| `MCP_UPSTREAM_TOKEN` | Token the gateway must send to the adapter |
| `WOOCOMMERCE_ALLOW_HTTP` | Allow a store without HTTPS; `false` by default |
| `PORT` | 3001 |
| `HOST`, `MCP_ALLOWED_HOSTS`, `WOOCOMMERCE_FORWARDED_PROTO` | Used only inside the cluster; commented out |

**`gateway/.env.example`: gateway**

| Setting | Meaning |
| --- | --- |
| `PORT`, `DATABASE_URL` | 3000; a local Postgres on port 5433 |
| `GATEWAY_ENCRYPTION_KEY` | 32 random bytes in base64; encrypts saved server credentials |
| `PUBLIC_URL` | Address of the dashboard, used to build invite links |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Create the first admin on an empty database |
| `TIMEZONE` | Lets chat know what "today" means |
| `CALL_TIMEOUT_MS`, `LIST_TIMEOUT_MS`, `HEALTH_INTERVAL_MS` | 15 s per call, 5 s per tool list, a health check every 15 s |
| `ALLOW_PRIVATE_UPSTREAMS`, `UPSTREAM_ALLOW_HOSTS` | Exceptions to the SSRF guard for local or in-cluster servers |
| `SEED_UPSTREAMS`, `WOO_MCP_TOKEN`, `UTILS_MCP_API_KEY` | Servers created on first start, with their credentials |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Chat provider; Groq with `openai/gpt-oss-120b` by default |

### What the generated files hold

| File | Names (values stay local) |
| --- | --- |
| `.local/platform-secrets.env` | `POSTGRES_PASSWORD`, `GATEWAY_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, `MCP_UPSTREAM_TOKEN`, `UTILS_MCP_API_KEY`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `STORE_ADMIN_USER`, `STORE_ADMIN_PASSWORD`, `STORE_ADMIN_EMAIL`, `LLM_API_KEY` |
| `.local/store-database.env` | `mysql-password`, `mysql-root-password` |

What each value is for, and how to print one: [SCENARIO.md §3](SCENARIO.md#3-credentials).

### When you need a `.env`

| Situation | `.env` needed? | Do |
| --- | --- | --- |
| Kubernetes setup, demo, another laptop | No | Run the scripts in [§3](#3-getting-started); they handle the secrets |
| Developing without Kubernetes (README, "Develop without Kubernetes") | Yes | Copy `.env.example` to `.env` and `gateway/.env.example` to `gateway/.env`, then fill in the blanks. Values from `.local/platform-secrets.env` can be reused. |

In `gateway/.env`, `WOO_MCP_TOKEN` must equal the adapter's `MCP_UPSTREAM_TOKEN`.
Never commit a filled-in `.env`, and never copy real values into a `.example` file.
