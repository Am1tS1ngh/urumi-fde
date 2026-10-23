# Threat model

What is being protected: the store's data and admin powers, the credentials for each
upstream server, and the record of who did what.

## Trust boundaries

1. **Internet to Ingress.** Anyone can reach the dashboard and `/mcp`.
2. **Gateway to upstreams.** Only the gateway may talk to MCP servers. Each server
   trusts whoever reaches it.
3. **Gateway to LLM.** Conversation text and tool results leave the cluster.
4. **Tool output to model.** Text from a store or a tool goes into the model's context
   and could try to steer it.

## Threats and what stops them

| Threat | Mitigation |
| --- | --- |
| Using `/mcp` without permission | Every request needs a member key. Keys are random 256-bit tokens, stored only as SHA-256 hashes. |
| A leaked key keeps working | Members and admins revoke a key in the dashboard. The next request is refused, because there is no cache. Disabling a person stops all their keys and sessions. |
| A database leak exposes secrets | Passwords use scrypt. Keys, sessions and invites are stored as hashes. Upstream credentials are encrypted with AES-256-GCM, and the key lives in a Secret, not in the database. |
| The dashboard reveals upstream credentials | The API returns `hasCredential` only. Credentials are decrypted in memory just before a request. |
| A member changes servers or roles | Admin routes check the role on the server for every request. The dashboard hiding buttons is not the control. |
| An admin registers an upstream URL that points inside the network (SSRF) | URLs are resolved and refused if they land on loopback, private, link-local or metadata addresses, unless the host is on `UPSTREAM_ALLOW_HOSTS`. The check runs again on every connection. Redirects are refused, and only `http` and `https` without embedded credentials are accepted. |
| Pods in the cluster call the adapter directly, skipping keys and audit | A default-deny NetworkPolicy. Only pods labelled as the gateway can reach MCP servers, and only the gateway can reach Postgres. The adapter also needs its own bearer token and checks the `Host` header. |
| Guessing passwords or invite tokens | Tokens are 256-bit random values. Login takes the same time for unknown emails, using a decoy hash. Invites are single-use and expire after 7 days. |
| Prompt injection through tool results, like a product description saying "ignore your instructions" | The system prompt treats tool output as data, not instructions. The model only gets the tools the member already has, and every call is audited. A model tricked into calling a tool can do no more than the member could. |
| A slow or hostile upstream ties up the gateway | Deadlines on listing (5 s) and calls (15 s), at most 500 tools per server, a 12k-character cap on what the model sees, and a 1 MB request body limit. |
| A tool name that confuses routing or the LLM | Names are limited to letters, digits, `_` and `-`, and always prefixed with the server slug. Anything else is hidden and listed as skipped. |
| Secrets in Git or Helm values | Charts reference Secrets by name only. The local script generates values into ignored `.local/` and applies them with `kubectl`. |
| Container escape or privilege misuse | Every container runs as non-root, with no privilege escalation, all capabilities dropped, a read-only root filesystem where possible, a RuntimeDefault seccomp profile, and no service account token. |

## Accepted risks

- **The audit log does not record arguments or results.** That keeps customer data
  out of it, but it means the log says *which* order was touched only through the
  store's own records.
- **The reference server's `get-env` tool shows its environment variables.** Its pod
  is given no secrets, so there is nothing sensitive to show. Disable that server in
  the dashboard if that is still too much.
- **Conversation content goes to the LLM provider.** Pick a provider whose data terms
  fit the store. Chat stays off until `LLM_API_KEY` is set.
- **No rate limiting at the gateway.** Add it at the Ingress for a public deployment.
- **Sessions are bearer tokens in browser storage.** A cross-site scripting bug would
  expose them. React escapes all output and the dashboard renders no HTML from the
  API, which keeps that surface small.
- **One admin account is created from environment values.** Rotate `ADMIN_PASSWORD`
  by changing it from the database or inviting a new admin and disabling the first.
