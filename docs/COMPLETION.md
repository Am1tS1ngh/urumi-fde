# Urumi MCP Gateway: Completion Report

Where the project stands against the assignment: what is built, what is still owed, which bonus
items remain, and whether the local environment is running.

| | |
| --- | --- |
| **As of** | 24 October 2026, about 11:00 IST |
| **Deadline** | 26 October 2026, 11:59 PM IST (about 2.5 days left) |
| **Build** | Complete. Every mandatory requirement is built and verified (70 of 70 checklist items). |
| **Still owed** | Submission work: finish the demo run, record the video, get [PR #1](https://github.com/nikhiljangid120/urumi-fde/pull/1) merged, submit. |
| **Bonus** | Optional. Not started, apart from some security hardening that is already in place. |
| **Environment** | Running: Docker, the k3d cluster and every pod are up (see [section 4](#4-live-environment)). |
| **Related** | [Status and setup](STATUS.md) · [Scenarios and run log](SCENARIO.md) · [Checklist](CHECKLIST.md) |
| **Which doc when** | Use this file for progress, the live check and moving to another laptop. For setup commands and fixes, use STATUS.md. For the demo and credentials, use SCENARIO.md. Full guide: [Which document to use](STATUS.md#which-document-to-use). |

## Contents

1. [Short answer](#1-short-answer)
2. [Mandatory requirements](#2-mandatory-requirements)
3. [Optional and bonus features](#3-optional-and-bonus-features)
4. [Live environment](#4-live-environment)
5. [Checking the environment yourself](#5-checking-the-environment-yourself)
6. [Plan for the remaining time](#6-plan-for-the-remaining-time)
7. [Running on another laptop](#7-running-on-another-laptop)

---

## 1. Short answer

**Is everything made?** Everything the assignment *requires you to build* is made and working.
It is not yet *submitted*: the video, the push to GitHub and the submission form are mandatory too.

**Is only the bonus left?** For building, yes. Overall, no: finish the submission items in
[section 2](#still-owed-submission-deliverables) first. The brief says a working core is worth more
than an unfinished bonus.

## 2. Mandatory requirements

### Built and verified

| Area | Requirement | State |
| --- | --- | --- |
| Store | Real WordPress + WooCommerce store in Kubernetes, set up automatically on deploy | Done |
| Adapter | Our own WooCommerce MCP server with 5 tools over Streamable HTTP | Done |
| Gateway | One endpoint for at least 3 upstream MCP servers (WooCommerce, Utilities, Reference: 31 tools) | Done |
| Routing | Tools named `<server>__<tool>`, so same-named tools never clash | Done |
| Access | Admin and member roles; invite links; per-user API keys, stored hashed, revocable at once | Done |
| Servers | Add, edit, disable, remove and health-check upstreams from the dashboard | Done |
| Credentials | Upstream credentials kept server-side and encrypted (AES-256-GCM) | Done |
| Audit | Every call logged with user, source, server, tool, result and duration | Done |
| Chat | Dashboard assistant using the same tools through a real LLM (Groq) | Done |
| Isolation | One upstream down, slow or disabled doesn't affect the others | Done |
| Kubernetes | Helm charts, Secrets, PVCs, Ingress, probes, requests and limits, NetworkPolicies, non-root containers | Done |
| Docs | README, design and trade-offs, threat model, upgrade and rollback, production values | Done |

Full detail: [CHECKLIST.md](CHECKLIST.md) and [STATUS.md §5](STATUS.md#5-requirement-status).

### Still owed: submission deliverables

| # | Item | State |
| --- | --- | --- |
| 1 | Two-user demo run, scenarios 1–10 | In progress: 1–4 passed ([run log](SCENARIO.md#10-run-log)) |
| 2 | Revoke the admin's "sample" key (shown in a screenshot) | To do |
| 3 | Record the demo video | To do |
| 4 | Commit the docs (STATUS, SCENARIO, COMPLETION, checklist, bootcamp) | Done |
| 5 | Push and open a pull request into `main` | Done: [PR #1](https://github.com/nikhiljangid120/urumi-fde/pull/1). The owner, `nikhiljangid120`, needs to merge it. |
| 6 | Make sure the repo and video are accessible, then submit the form | To do |
| 7 | Rotate the Groq key | To do, after recording |

## 3. Optional and bonus features

None of these are required. "Partly" means groundwork exists, but not the full bonus feature.

| Bonus | State | What exists today |
| --- | --- | --- |
| Multi-store provisioning | Not started | One store |
| Real VPS deployment | Not started | `values-prod.yaml` files and documented production steps |
| Per-tool permissions | Not started | Admin/member roles; every member sees every enabled tool |
| OAuth | Not started | Static API keys (`mcpk_…`) and dashboard sessions |
| Tool search for large catalogs | Not started | All 31 tools listed at once |
| Deploy upstreams from a container image | Partly | Helm values deploy containerized upstreams; the dashboard can only register a URL |
| Advanced security hardening | Partly | Encryption at rest, SSRF guard with DNS checks, NetworkPolicies, non-root containers, hashed keys. No rate limiting or audit retention. |
| Multiple gateway replicas, rate limits | Not started | One replica (state cached in memory); rate limiting noted for the Ingress |
| Advanced metrics | Not started | Health checks, server status and the audit log |
| Upgrade and rollback automation | Partly | Timestamped image tags, `helm upgrade`, and a manually tested, documented `helm rollback` |

**If time remains after submission work**, these have the best value for the effort:

1. **Rate limiting at the Ingress.** A Traefik middleware, configured in Helm values; no gateway code.
2. **Per-tool permissions.** Admins allow or block individual tools for members, enforced in the tool router.
3. **Upgrade and rollback automation.** A script that runs `helm upgrade`, checks health, and rolls back on failure.

## 4. Live environment

Checked on 24 Oct 2026, about 11:00 IST.

### Docker and the cluster

| Component | State | Details |
| --- | --- | --- |
| Docker Desktop | **Running** | Engine 29.6.1, WSL2, 8 CPUs, 4.8 GiB memory, cgroup v1 |
| k3d cluster `urumi` | **Running** | 1 server, load balancer on port 8080; both containers up 10 hours |
| Kubernetes node | **Ready** | `k3d-urumi-server-0`, k3s v1.35.5, containerd 2.2.3 |
| Resource use | Normal | About 17% CPU and 2.0 of 4.8 GiB memory |

### Pods

| Namespace | Pod | State |
| --- | --- | --- |
| `urumi-platform` | `gateway` | Running |
| `urumi-platform` | `gateway-postgres-0` | Running |
| `urumi-platform` | `dashboard` | Running |
| `urumi-platform` | `woo-mcp` (WooCommerce adapter) | Running |
| `urumi-platform` | `utils-mcp` | Running |
| `urumi-platform` | `everything-mcp` (reference server) | Running |
| `urumi` | `store-wordpress` | Running |
| `urumi` | `store-mysql` | Running |
| `urumi` | `store-setup` (setup Job) | Completed (expected; it runs once per deploy) |
| `kube-system` | Traefik, CoreDNS, metrics-server, storage provisioner | Running |

Zero restarts across all pods.

### Helm releases

| Release | Namespace | Revision | Last deployed |
| --- | --- | --- | --- |
| `platform` | `urumi-platform` | 9 | 24 Oct, 09:59 IST |
| `store` | `urumi` | 5 | 24 Oct, 09:54 IST |
| `traefik`, `traefik-crd` | `kube-system` | 1 | Built into k3s |

### Storage, networking and endpoints

| Item | State |
| --- | --- |
| Volumes | 3 bound: gateway Postgres 2 Gi, store MySQL 2 Gi, WordPress 1 Gi |
| Ingress | `gateway.localhost` and `store.localhost`, both through Traefik on port 8080 |
| NetworkPolicies | 4 in `urumi-platform`: deny by default; allow ingress to the dashboard and gateway; allow only the gateway to reach upstreams and Postgres |
| Dashboard | `http://gateway.localhost:8080`: 200 OK |
| MCP endpoint | `http://127.0.0.1:8080/mcp`: 401 without a key (correct) |
| Dashboard API | 401 without a session (correct) |
| Store | `http://store.localhost:8080`: responding |

## 5. Checking the environment yourself

Run from `urumi-fde` in PowerShell:

```powershell
docker info --format '{{.ServerVersion}}'                                  # Docker is up
.\.local\tools\k3d.exe cluster list                                        # cluster running: 1/1
kubectl --kubeconfig .local\kubeconfig get nodes                           # Ready
kubectl --kubeconfig .local\kubeconfig get pods -A                         # all Running or Completed
.\.local\tools\helm.exe --kubeconfig .local\kubeconfig list -A             # platform, store deployed
```

| If you see | Do |
| --- | --- |
| `docker info` fails | Start Docker Desktop and wait for **Engine running** |
| Cluster `0/1` or missing | `.\scripts\create-local-cluster.ps1` (keeps existing data) |
| Pods not Running | Wait a minute after a start, then see [STATUS.md §10](STATUS.md#10-troubleshooting) |

To stop everything at the end of the day: `.\.local\tools\k3d.exe cluster stop urumi`, then quit Docker
Desktop. Data is kept for next time.

## 6. Plan for the remaining time

| When | Do |
| --- | --- |
| 24 Oct | Finish scenarios 5–10 ([SCENARIO.md](SCENARIO.md)); revoke the "sample" key |
| 25 Oct | Record the video; commit and push; check the repo from a signed-out browser |
| 26 Oct, by evening | Submit the form, leaving a buffer before 11:59 PM IST; then rotate the Groq key |
| Only if time remains | One of the bonus picks in [section 3](#3-optional-and-bonus-features), on a separate branch |

## 7. Running on another laptop

The project rebuilds itself from the code. A second laptop needs the code, Docker Desktop and four
scripts; everything else downloads automatically. Allow 20–30 minutes the first time, mostly downloads.

### What carries over

| Item | Carries over? | How |
| --- | --- | --- |
| Code | Yes | Clone from GitHub once `core-build` is pushed, or copy the folder ([step 3](#step-3-get-the-code)) |
| Passwords and keys (`.local\platform-secrets.env`, `.local\store-database.env`) | Optional | Not in Git. Without them, new ones are generated. Copy them only to keep the same passwords, and only over a private channel such as a USB drive. |
| Tools, kubeconfig (`.local\tools`, `.local\kubeconfig`) | No | Re-downloaded and regenerated by the scripts. Don't copy them. |
| Store data, members, API keys, audit log | No | Stays in this laptop's cluster. The new laptop starts fresh: the seeded admin, the three servers, and one sample product. |
| Groq key | Re-enter it | Pass it to `create-local-secrets.ps1` (step 6 below) |

Because the data is fresh, order and product numbers will differ from the [run log](SCENARIO.md#10-run-log).
Run the scenarios from 1 again and note the new numbers.

### Step 1: Check the laptop

| Requirement | Why |
| --- | --- |
| Windows 10 or 11, **x64** | The scripts are PowerShell and download Windows x64 tools. macOS, Linux and ARM laptops aren't supported by the scripts. |
| About **8 GB RAM or more** (6 GB for Docker), **10 GB** free disk | The cluster runs WordPress, MySQL, Postgres and six services |
| Ports **6550**, **8080** and **8443** free | Cluster API and ingress |
| Internet access, not blocked by a proxy or antivirus | Images, k3d, Helm and WooCommerce downloads |
| Administrator rights | Installing Docker Desktop and WSL2 |

### Step 2: Install

| Install | Command | Notes |
| --- | --- | --- |
| Docker Desktop | `winget install Docker.DockerDesktop` | Choose the WSL2 engine. Restart if asked, then open it and wait for **Engine running**. It includes `kubectl`. |
| Git | `winget install Git.Git` | Only needed to clone the repo or commit from that laptop |

You don't need Node.js, k3d or Helm: images build inside Docker, and the scripts fetch pinned k3d and
Helm. Node.js 22.13+ is only for running the tests or developing outside Docker.

If Docker has too little memory, create `C:\Users\<you>\.wslconfig` with the lines `[wsl2]` and
`memory=6GB`, run `wsl --shutdown`, then restart Docker Desktop.

### Step 3: Get the code

**Option A, clone (after `core-build` is pushed).** The GitHub account must have access to the repo.

```powershell
git clone https://github.com/nikhiljangid120/urumi-fde.git
cd urumi-fde
git checkout core-build
```

**Option B, copy the folder.** Zip `urumi-fde` and leave out `node_modules`, `dist`, `.local\tools`,
`.local\downloads` and `.local\kubeconfig`. Include the two `.env` files from `.local\` only if you want
the same passwords, and treat the zip as secret if you do.

### Step 4: Open PowerShell in the folder

```powershell
cd C:\path\to\urumi-fde
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
docker info --format '{{.ServerVersion}}'    # a version number means Docker is ready
```

### Step 5: Build and deploy, in this order

```powershell
.\scripts\install-local-tools.ps1          # once: k3d v5.9.0 and Helm v4.3.1 into .local\tools
.\scripts\create-local-cluster.ps1         # 1-3 min: cluster "urumi", node Ready
.\scripts\deploy-store-foundation.ps1      # 5-10 min: store, plus every password in .local\
.\scripts\deploy-platform.ps1              # 3-5 min: builds the images and deploys six pods
```

If a deploy times out on the first run, images are still downloading. Run the same script again.
Don't add `2>&1` or `*>` to these commands in Windows PowerShell 5.1.

### Step 6: Turn on chat

```powershell
.\scripts\create-local-secrets.ps1 -LlmApiKey '<groq key>'
kubectl --kubeconfig .local\kubeconfig -n urumi-platform rollout restart deployment gateway
```

### Step 7: Check that it works

```powershell
kubectl --kubeconfig .local\kubeconfig get pods -A          # everything Running, store-setup Completed
Select-String -Path .local\platform-secrets.env -Pattern '^(ADMIN_PASSWORD|STORE_ADMIN_USER|STORE_ADMIN_PASSWORD)='
```

1. Open http://gateway.localhost:8080 and sign in as `admin@urumi.local` with `ADMIN_PASSWORD`.
2. On **Servers**, all three should show **Connected**.
3. On **Chat**, the header should name the model.
4. Open http://store.localhost:8080; the shop should load.
5. Continue with [SCENARIO.md](SCENARIO.md) from scenario 1.

### Daily use on that laptop

| When | Do |
| --- | --- |
| Start of day | Start Docker Desktop, then `.\scripts\create-local-cluster.ps1` (starts the existing cluster and keeps data) |
| End of day | `.\.local\tools\k3d.exe cluster stop urumi` |
| After pulling new code | `.\scripts\deploy-platform.ps1` |
| Committing from that laptop | First set the author: `git config user.name "<name>"` and `git config user.email "<email>"` |

The two laptops run separate clusters with separate data. Record the demo on one of them, and stop the
cluster on the other (`.\.local\tools\k3d.exe cluster stop urumi`) to free its memory.
