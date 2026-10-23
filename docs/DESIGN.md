# Design

## The pieces

```
 people ──► Ingress (gateway.localhost)
              ├── /        ► dashboard   React app served by nginx
              ├── /api     ► gateway     REST API for the dashboard
              └── /mcp     ► gateway     one MCP endpoint for every client
                                 │
          gateway ──► Postgres          users, sessions, invites, keys, upstreams, audit log
          gateway ──► LLM API           OpenAI-compatible chat completions (chat page only)
          gateway ──► woo-mcp ──► WordPress + WooCommerce (namespace urumi)
          gateway ──► utils-mcp
          gateway ──► everything-mcp
```

Everything except the store runs in the `urumi-platform` namespace and is
installed by one Helm chart (`charts/platform`). The store has its own chart
(`charts/store`) in the `urumi` namespace, because it has its own lifecycle and data.

| Service | What it does |
| --- | --- |
| `gateway` | NestJS. Checks member keys, merges tools from every enabled upstream, routes calls, writes the audit log, runs the chat loop. |
| `dashboard` | React + Vite, built to static files. Talks only to `/api`. |
| `woo-mcp` | The WooCommerce adapter: five store tools over Streamable HTTP. |
| `utils-mcp` | Small helper server: currency conversion, time, echo, sleep. |
| `everything-mcp` | The official MCP reference server, pinned to 2.0.0. |
| `gateway-postgres` | Postgres 17, one replica, persistent volume. |

## One request, end to end

1. An MCP client sends `tools/call` for `woo__get_order` to `/mcp` with
   `Authorization: Bearer mcpk_…`.
2. The gateway hashes the key and looks it up. A missing, unknown or revoked key
   gets a 401 straight away. Revoked-key attempts are still written to the audit log.
3. The name is split at the first `__` into the server slug `woo` and the tool
   `get_order`. An unknown slug or a disabled server is refused.
4. The gateway reuses its MCP client session for that upstream, or opens one with
   the stored credential, and forwards the call with a 15 second deadline.
5. The result goes back to the caller unchanged, and one audit row is written with
   the user, server, tool, outcome and duration.

Chat runs the same path. The dashboard sends the conversation to `/api/chat`. The
gateway gives the model the current tool list and runs each tool call it asks for
through the same router as the signed-in member. The tool trace is returned with the
reply. Audit rows from chat have source `chat`, so they are easy to tell apart.

## Tool names and collisions

Every tool is exposed as `<server slug>__<tool name>`, for example `woo__list_orders`.

- Slugs are unique, 2 to 20 lowercase letters or digits, and cannot change after the
  server is created. Two servers can never produce the same exposed name.
- Both `utils` and `everything` have a tool called `echo`. They show up as
  `utils__echo` and `everything__echo`, and each call goes to the right server.
- A tool is hidden if its name has characters outside `A-Z a-z 0-9 _ -` or is longer
  than 40 characters. This keeps every exposed name within the 64-character limit
  that LLM APIs place on function names. Hidden tools are listed on the server's card
  in the dashboard, so nothing disappears silently.
- Descriptions are prefixed with the server name, like `[WooCommerce] List orders…`,
  so people and models can see where a tool comes from.

Prefixing was chosen over first-registered-wins or failing on conflict. The
alternatives make a tool's name depend on which servers happen to be enabled, which
breaks saved prompts and client configs.

## Failures stay contained

- Listing tools from one server has a 5 second deadline and a call has 15 seconds.
  A slow or dead server only removes its own tools.
- A background check refreshes every server's status every 15 seconds. A server
  that fails shows as **Unreachable** with the reason, and its tools leave
  `tools/list` until it recovers, which shows up within one check. Results are
  reused for 10 seconds, so a burst of clients does not turn into a burst of
  upstream requests.
- Any error drops the cached client session for that server. The next call opens a
  fresh one, so a restarted upstream is picked up without restarting the gateway.
- Disabling a server removes its tools immediately. Calls to it are refused and
  audited as `denied`.

## Team access

- The first admin is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` on an empty
  database. Everyone else joins through a one-time invite link that expires in 7 days.
- Two roles. **Admins** manage servers, people and roles, can issue keys to members,
  and see the whole audit log. **Members** see servers and tools, manage their own
  keys, use chat and see their own audit history.
- Dashboard sessions are random tokens, stored as SHA-256 hashes, valid for 12 hours.
  Disabling a person ends their sessions and makes their keys stop working.
- Member keys start with `mcpk_`. Only a SHA-256 hash and a short display prefix are
  stored, and the full key is shown once. Each person can hold up to 10 active keys.
  Revoking takes effect on the very next request, because every request checks the
  database. There is no key cache to wait out.

## Storage

Postgres holds everything the gateway needs. The schema is applied on start, under an
advisory lock, so a second replica cannot race the first. Upstream credentials are
encrypted with AES-256-GCM using `GATEWAY_ENCRYPTION_KEY`, and the API only ever says
whether a credential is set.

The store's MySQL and WordPress files each have their own PersistentVolumeClaim. The
setup Job installs WooCommerce, turns on cash on delivery, opens the shop and creates
the adapter's API key from a Secret. Every step checks first, so it runs safely after
each install and upgrade.

## Trade-offs

- **One gateway replica.** Status snapshots and upstream sessions live in memory.
  Two replicas would still be correct, since all state that matters is in Postgres,
  but each would probe upstreams on its own. Shared caching was not worth it at this size.
- **Database lookup on every MCP request.** This is the price of instant revocation.
  It is a single indexed query.
- **No streaming in chat.** The reply arrives when the tool loop finishes, at most six
  model steps. Streaming would add complexity without changing what the demo shows.
- **Upstreams are pinned in Helm values and seeded once.** After the first start the
  dashboard owns the list. Deleting a seeded server in the dashboard is respected on
  later restarts.
- **Plain HTTP inside the cluster.** The adapter talks to WordPress over the cluster
  network and sends `X-Forwarded-Proto: https`, which WordPress already trusts.
  NetworkPolicy, not TLS, protects the gateway-to-upstream hop.

## Upgrades and rollback

Each deploy builds images with a new tag and runs `helm upgrade --install`.
Kubernetes replaces pods one at a time and only sends traffic to a new pod once its
readiness probe passes. A gateway that cannot reach Postgres never becomes ready, so
the old pod keeps serving.

```powershell
.local\tools\helm.exe --kubeconfig .local\kubeconfig -n urumi-platform history platform
.local\tools\helm.exe --kubeconfig .local\kubeconfig -n urumi-platform rollback platform <revision>
```

Rollback puts back the previous manifests and image tags. Data is not rolled back.
The schema only ever adds tables or columns with `IF NOT EXISTS`, so an older gateway
still runs against a newer database. Persistent volumes are kept across upgrades,
rollbacks and `helm uninstall`.
