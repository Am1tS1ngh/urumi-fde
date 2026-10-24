# Urumi MCP Gateway Bootcamp — START HERE
## From "five working tools" to a submitted, defensible MCP gateway on Kubernetes

> **Format**: freeCodeCamp-style, same as the TaskFlow bootcamp. Small lessons. You type (or have Codex type) every line. You **validate** it works. Then you move on.
>
> **Starting point**: What you already have on 23 Oct 2026. WordPress + WooCommerce + MySQL running in k3d through Helm, plus a NestJS WooCommerce MCP adapter with all five tools, running on your laptop at `http://127.0.0.1:3001/mcp`.
>
> **End state**: Everything in the brief's "Definition of done" working with two users, deployed with Helm on local Kubernetes. You also have a README, a design note, a threat model, a recorded demo video, and answers ready for the Round 2 walkthrough.
>
> **Deadline**: **26 Oct 2026, 11:59 PM IST**. Plan to submit by **9 PM** so a slow upload doesn't sink you.

---

## How this bootcamp is split

| File | What it covers | Phases |
| --- | --- | --- |
| `00_START_HERE.md` (this file) | Roadmap, the 3-day schedule, the architecture at a glance, every design decision in one table, how to work with Codex | — |
| `Part1_Concepts_and_What_You_Built.md` | **Learn the theory.** MCP protocol, the gateway pattern, Kubernetes resources, Helm, hashing and encryption. Explaining your existing store + adapter like an expert. | 0 – 4 |
| `Part2_Gateway_Backend.md` | **The gateway.** NestJS backend, Postgres schema, users, invites, sessions, hashed API keys, upstream registry, SSRF guard, MCP client pool, tool router with namespacing + timeouts, audit log, the single `/mcp` endpoint, two more upstream MCP servers. Local end-to-end test with MCP Inspector. | 5 – 13 |
| `Part3_Dashboard_and_Chat_Agent.md` | **The UI and the agent.** React dashboard (servers, members, keys, audit, chat) and the LLM tool loop that acts as the logged-in user. | 14 – 18 |
| `Part4_Kubernetes_Helm_Deploy.md` | **Ship it to Kubernetes.** Dockerfiles, adapter changes for in-cluster use, the `platform` Helm chart, Secrets, NetworkPolicies, probes, limits, deploy to k3d, VPS/k3s path, upgrade and rollback. | 19 – 26 |
| `Part5_Demo_Docs_Interview.md` | **Win the submission.** Acceptance runbook (definition of done, step by step), README / DESIGN / THREAT_MODEL content, demo video script, 70+ interview questions with answers, master troubleshooting table, final checklist. | 27 – 32 |

Read the parts in order. Part 1 is mostly reading, and it's what stops you from going blank in the interview.

---

## How to use this guide (recap)

Same conventions as the TaskFlow bootcamp:

- Lines starting with `PS>` are **PowerShell** commands (you're on Windows). Don't type the `PS>`.
- Lines starting with `$` are bash commands. You only need these on a Linux VPS.
- Each lesson has: header, **Why now?**, numbered steps, **Validate**, **Heads up**, **What just happened?**
- New in this bootcamp: **🧠 Intuition** boxes (an analogy before the theory), **🤖 Codex prompt** boxes (what to paste into Codex), and **🎤 Interview angle** boxes (how this comes up in Round 2).
- Don't move on until **Validate** passes. A broken step compounds.

> ⚠️ **Heads up — about versions**
> Your project uses very recent versions (TypeScript 7, NestJS 12, MCP SDK 2.x split packages). Exact APIs drift. Every code block in this bootcamp was written against stable, well-documented APIs. When something doesn't compile, the fix is almost always one of:
> 1. An import path changed: copy the import style from a file that already works in your repo.
> 2. A type got stricter: add the explicit type or a narrow cast, then move on.
> 3. A config flag differs: copy `tsconfig.json` settings from your working adapter.
>
> Don't panic. Paste the exact error into Codex together with the file, apply the fix, and continue.

---

## The 3-day plan (you have ~3.5 days, not 2 weeks)

The brief says it plainly: **"A working core is worth more than an unfinished bonus."** So this schedule only covers the mandatory core plus the cheap standout items (encryption at rest, SSRF guard, NetworkPolicies, non-root containers, upgrade/rollback docs).

| When | Goal | Parts / Phases | Done when |
| --- | --- | --- | --- |
| **Thu 23 Oct, evening (3–4 h)** | Understand the system. Scaffold the gateway, Postgres, crypto helpers. | Part 1 (skim, then come back), Part 2 Phases 5–7 | `npm run dev` in `gateway/` boots and creates tables |
| **Fri 24 Oct (10 h)** | Gateway core works locally | Part 2 Phases 8–13 | MCP Inspector, using a member key, sees `woo__*`, `utils__*` and `everything__*` tools and calls `woo__list_orders` |
| **Sat 25 Oct, morning (5 h)** | Dashboard + chat | Part 3 | User A creates a product through chat in the browser |
| **Sat 25 Oct, afternoon/night (6 h)** | Everything inside Kubernetes | Part 4 Phases 19–24 | `helm upgrade --install platform …` and the whole DoD works at `http://gateway.localhost:8080` |
| **Sun 26 Oct, morning (4 h)** | Docs + full acceptance dry run | Part 4 Phase 26, Part 5 Phases 27–29 | README, DESIGN, THREAT_MODEL committed. Full DoD passes start to finish without fixes |
| **Sun 26 Oct, afternoon (4 h)** | Record + submit | Part 5 Phases 30–32 | Video uploaded, repo public/shared, form submitted **by 9 PM** |

**What to cut if you fall behind (in this order):** VPS deployment → store bootstrap Job → the `everything` upstream (use the public DeepWiki server instead) → stats endpoint → polish in the dashboard. **Never cut:** two users, revoke, disable, kill-a-pod, audit log, the threat model note.

---

## The architecture at a glance

```
                          ┌──────────────────────────── k3d cluster (k3s) ────────────────────────────────┐
                          │                                                                                │
 Browser ──► store.localhost:8080 ──► Traefik Ingress ──► WordPress + WooCommerce ──► MySQL (PVC)         │
                          │                  │                    ▲   namespace: urumi                     │
                          │                  │                    │  REST /wp-json/wc/v3 (consumer key)    │
                          │                  │                    │                                        │
 Browser ──► gateway.localhost:8080 ─────────┤          ┌─────────┴──────────┐                             │
   (dashboard + chat)     │                  │          │ woo-mcp (YOUR      │◄──┐                         │
                          │      "/"  ───────┼──► dashboard (nginx)          │   │                         │
                          │      "/api" ─────┼──► ┌───────────────┐ adapter) │   │  MCP over Streamable    │
 Claude Code / Cursor /   │      "/mcp" ─────┴──► │  gateway      │──────────────┤  HTTP + upstream creds  │
 MCP Inspector ───────────┼────────────────────►  │  (NestJS)     │──► utils-mcp ┤  (only the gateway can  │
   (gateway URL + key)    │                       │  MCP server   │──► everything┘   reach these: Netpol)   │
                          │                       │  + MCP client │                                         │
                          │                       └──────┬────────┘                                         │
                          │                              │  users, keys (hashed), upstreams (creds          │
                          │                              ▼  AES-GCM encrypted), audit log                   │
                          │                       gateway-postgres (StatefulSet + PVC)                      │
                          │                                         namespace: urumi-platform               │
                          └────────────────────────────────────────────────────────────────────────────────┘
                                                           │
                                                           ▼  (only from the gateway pod)
                                                 LLM provider (Groq / Gemini / Ollama), OpenAI-compatible API
```

**One sentence you should be able to say in your sleep:**
> "Every tool call, whether it comes from Claude Code or from the dashboard chat, enters the gateway. The gateway authenticates the user, finds the upstream server from the tool's name prefix, attaches that server's secret credential on the server side, calls it with a timeout, writes an audit row attributed to the user, and returns the result. Nothing else can reach the upstream servers."

---

## Every design decision, in one table

You'll be asked "why?" about every row. Part 1 and Part 5 go deeper.

| Decision | Choice | One-line why |
| --- | --- | --- |
| Gateway backend framework | **NestJS** (same as your adapter) | One mental model across both services. You already know its modules, guards and DI from TaskFlow. |
| Gateway MCP library | `@modelcontextprotocol/sdk` 1.x (low-level `Server` + `Client`) | Mature, well-documented API. A proxy needs the *low-level* server because tool schemas are dynamic JSON, not Zod. The wire protocol is the same as your v2 adapter's. |
| Gateway endpoint mode | **Stateless** Streamable HTTP with JSON responses | Each POST stands alone. No sticky sessions, so it scales to N replicas and survives restarts. |
| Tool collision scheme | **Namespacing**: `<serverSlug>__<toolName>`, e.g. `woo__list_orders` | Collisions can't happen by construction. `__` is valid in MCP *and* in OpenAI function names. Slugs can't contain `_`, so splitting at the first `__` is unambiguous. |
| Gateway database | **PostgreSQL** (StatefulSet + PVC), plain `pg` + SQL | Relational data (users ↔ keys ↔ audit). Plain SQL is easy to explain and has no ORM magic. |
| API keys | Random 256-bit `mcpk_…`, stored as **SHA-256** | High-entropy secrets don't need slow hashing. Fast lookup by hash, and a DB leak gives away no usable key. |
| Passwords | **scrypt** (Node built-in) | Low-entropy secrets need a slow, salted KDF. No native dependencies. |
| Dashboard sessions | Opaque `ses_…` token, hashed in DB, 12 h TTL | Revocable instantly (logout, user disabled). Same pattern as TaskFlow refresh tokens. |
| Upstream credentials | **AES-256-GCM** encrypted at rest, key in a K8s Secret | A DB dump alone doesn't leak upstream tokens. They're decrypted only in memory, right before a call. |
| Roles | `admin`, `member` | Admin manages servers and members. Members use tools and manage their own keys. |
| Timeouts | list 4 s, call 15 s (Helm values) | A slow or dead upstream fails fast with a clear error and never blocks other servers. |
| Failure isolation | Per-upstream health snapshots, list via `Promise.all` of never-rejecting refreshes | A dead server drops out of the list and the others are unaffected. |
| Chat agent | OpenAI-compatible `/chat/completions` (Groq/Gemini free tier, or Ollama) | Provider-agnostic. Swapping models is a Helm value change. |
| Chat ↔ gateway | Chat calls the **same `ToolRouter`** as `/mcp` with the session user | Same auth, same routing, same audit. "Acts as the logged-in user" holds by construction. |
| Adapter isolation | ClusterIP Service + **NetworkPolicy** (only gateway pods) + adapter bearer token | Not reachable from outside the cluster, and not from other pods either. Defense in depth. |
| Store access from adapter | **WooCommerce REST API** with a read/write consumer key | Goes through WooCommerce's business logic (stock, hooks, validation). Least privilege. No shell or DB access needed. |
| Local domains | `store.localhost`, `gateway.localhost` on port 8080 (+ hosts-file entries for CLI tools) | Browsers resolve `*.localhost` to 127.0.0.1 automatically. One Traefik entrypoint serves both. |
| Packaging | Helm charts `store` + `platform`, `values-local.yaml` / `values-prod.yaml` | The brief mandates Helm. Local vs prod differences live only in values. |

---

## How to work with Codex on this bootcamp (and still learn)

You're building with an AI agent, and the interviewers know that. What they test is whether **you** understand what was built. Use this loop for every lesson:

1. **Read the lesson's "Why now?" and "🧠 Intuition" yourself first.** Takes 2 minutes. Don't skip it.
2. **Give Codex the lesson.** Paste the 🤖 Codex prompt (or the code blocks) and ask it to create the files exactly as written, adapting only imports and versions to the repo.
3. **Run Validate yourself.** Don't let Codex claim it passed. You see the output.
4. **Explain it back.** Close the file and say out loud, in 3 sentences, what the code does and why. If you can't, re-read "What just happened?".
5. **Commit.** `git add -A; git commit -m "phase N: <what>"`. Small commits are also your rollback plan.

> 🤖 **Codex prompt (use at the start of every session)**
> ```
> You are helping me implement the Urumi MCP Gateway assignment. The repo root is the existing
> WooCommerce MCP adapter (NestJS, ESM, strict TS). Do NOT modify or move existing adapter files
> unless the lesson says so. I will paste one lesson at a time from my bootcamp. Create files
> exactly as given; only adapt import paths, versions or types if compilation fails, and tell me
> each adaptation you made and why. After writing files, list the exact commands I should run to
> validate. Never put secrets in source files or commit .env / .local.
> ```

---

## Glossary: 25 words you'll say in the demo

| Term | Plain English |
| --- | --- |
| **MCP** | Model Context Protocol. A standard way for AI apps (clients) to discover and call tools exposed by servers. JSON-RPC 2.0 messages. |
| **MCP server** | A program that exposes tools (and optionally resources and prompts). Your WooCommerce adapter is one. |
| **MCP client** | A program that connects to an MCP server and calls its tools. Claude Code is one. **Your gateway is both a client and a server.** |
| **Streamable HTTP** | The MCP transport over HTTP: the client POSTs JSON-RPC to one URL, and the server answers with JSON or an SSE stream. |
| **JSON-RPC** | `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{…}}` → `{"jsonrpc":"2.0","id":1,"result":{…}}` |
| **tools/list, tools/call** | The two MCP methods that matter most here: discover tools, then invoke one. |
| **Upstream** | A real MCP server behind the gateway (woo, utils, everything). |
| **Gateway** | The single front door that aggregates upstreams and enforces auth, routing, timeouts and audit. |
| **Namespacing** | Prefixing tool names with the server slug so two servers can expose `echo` without clashing. |
| **API key** | A user's personal secret for the gateway (`mcpk_…`). Stored hashed. Revocable. |
| **Upstream credential** | The secret the gateway uses to call an upstream. Members never see it. |
| **Audit log** | Append-only record of every tool call: who, which server/tool, when, how long, outcome. |
| **Tool loop** | LLM → asks for a tool → gateway runs it → result back to LLM → repeat → final answer. |
| **Pod** | One running instance of a container (or a few tightly-coupled ones) in Kubernetes. |
| **Deployment** | Keeps N identical pods running and replaces dead ones. |
| **StatefulSet** | Like a Deployment, but for stateful apps. Stable identity, each pod gets its own volume. |
| **Service** | A stable in-cluster DNS name + virtual IP that load-balances to matching pods. |
| **Ingress** | HTTP routing from outside the cluster to Services, by host and path. Traefik implements it in k3s. |
| **Secret** | Kubernetes object holding sensitive values, injected as env vars or files. |
| **PVC** | PersistentVolumeClaim. A request for disk that survives pod restarts. |
| **Probes** | Startup / readiness / liveness checks that tell Kubernetes when to send traffic and when to restart. |
| **Requests / limits** | The CPU/memory a pod is guaranteed (requests) and can't exceed (limits). |
| **NetworkPolicy** | A pod-level firewall rule: who may connect to whom. |
| **Helm chart / values** | A templated bundle of Kubernetes YAML plus the per-environment knobs that fill in the templates. |
| **SSRF** | Server-Side Request Forgery: tricking a server into calling internal addresses for you. |

---

## Before you start: a 10-minute health check

**Step 1.** Start the existing cluster and confirm the store is healthy:

```powershell
PS> cd "D:\123\Other FIles\Interview Preparation\urumi-mcp-gateway"
PS> .\scripts\create-local-cluster.ps1
PS> kubectl --kubeconfig .local/kubeconfig -n urumi get pods,pvc
```

**Step 2.** Run the existing adapter smoke test (read-only):

```powershell
PS> .\scripts\run-local-adapter.ps1 -Smoke
```

**Step 3.** Make sure the repo is a git repo with a clean tree, and tag the current state:

```powershell
PS> git status
PS> git add -A; git commit -m "checkpoint: store + five-tool adapter"   # if anything is uncommitted
PS> git tag checkpoint-adapter-done
```

> ✅ **Validate**
> All store pods are `Running` and `READY 1/1`, PVCs are `Bound`, and the smoke test lists the five tools. You have a git tag to return to if anything goes badly wrong.

> ⚠️ **Heads up**
> If the smoke test fails, fix that **first**. The gateway sits on top of the adapter, and debugging two layers at once costs you hours. Check the `.env` values, check that the local CA exists, and check the store pods.

> 💡 **What just happened?**
> You proved the foundation still works and created a safe rollback point. The tag `checkpoint-adapter-done` is also a nice detail to point out in the interview: "I tag milestones so I can always diff and roll back."

When you're ready, open **Part 1**.
