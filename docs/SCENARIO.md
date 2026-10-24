# Urumi MCP Gateway: Demo Scenarios

A click-by-click script for showing the project working, in the order of the assignment's
acceptance flow. Each scenario lists what to do, what you should see, and what the audit log records.

| | |
| --- | --- |
| **Audience** | Whoever runs the demo or reviews it |
| **Time needed** | About 20 minutes for all ten scenarios |
| **Progress** | Scenarios 1–4 passed on 24 Oct; next is scenario 5 (see [Run log](#10-run-log)) |
| **Related** | [Completion report](COMPLETION.md) · [Status and setup](STATUS.md) · [Checklist](CHECKLIST.md) · [Design](DESIGN.md) |
| **Which doc when** | Use this file to run the demo. For setup and fixes, use STATUS.md. For overall progress, use COMPLETION.md. Full guide: [Which document to use](STATUS.md#which-document-to-use). |

## Contents

1. [Before you start](#1-before-you-start)
2. [Cast](#2-cast)
3. [Credentials](#3-credentials)
4. [Scenarios](#4-scenarios)
5. [Extra scenarios](#5-extra-scenarios)
6. [Reading the audit log](#6-reading-the-audit-log)
7. [Demo tips](#7-demo-tips)
8. [Cleaning up and resetting](#8-cleaning-up-and-resetting)
9. [Recording checklist](#9-recording-checklist)
10. [Run log](#10-run-log)

---

## 1. Before you start

| Check | How | Expected |
| --- | --- | --- |
| Docker Desktop is running | Tray icon | **Engine running** |
| The cluster is up | `.\scripts\create-local-cluster.ps1` | Node `Ready` |
| All pods are ready | `kubectl --kubeconfig .local\kubeconfig -n urumi-platform get pods` | 6 pods `1/1 Running` |
| Chat is configured | Dashboard → **Chat** | "Model openai/gpt-oss-120b · N tools available" |
| You have the passwords | See [Credentials](#3-credentials) | Admin and store passwords to hand |
| The store is warm | Open http://store.localhost:8080 once | The page loads (see [Demo tips](#7-demo-tips)) |

Use **two browser windows**: a normal one for User A (admin) and a private one for User B (member),
so the two sessions don't share a sign-in.

## 2. Cast

| Role | Who | Where they work |
| --- | --- | --- |
| **Customer** | Anyone | Storefront: http://store.localhost:8080 |
| **User A** | The admin, `admin@urumi.local` | Dashboard, normal window |
| **User B** | A member you invite | Dashboard (private window) and an external MCP client |
| **Store admin** | `STORE_ADMIN_USER` | WordPress admin: http://store.localhost:8080/wp-admin |

## 3. Credentials

Real values are never written into the repo. The setup scripts generate them on the first run, save them
in `.local\` (ignored by Git), and copy them into Kubernetes Secrets. Later runs reuse the same values.
To read a value on your own machine, see [Printing a value](#printing-a-value).

### Sign-ins for people

| Who | Sign in at | Username | Password |
| --- | --- | --- | --- |
| **Gateway admin** (User A) | Dashboard, http://gateway.localhost:8080 | `admin@urumi.local` (`gateway.adminEmail` in `charts/platform/values-local.yaml`) | `ADMIN_PASSWORD` |
| **Members** (User B and others) | Dashboard | The email they were invited with | Chosen by the member when accepting the invite (12+ characters). Only a hash is stored, so nobody can look it up. |
| **Store admin** | http://store.localhost:8080/wp-admin | `STORE_ADMIN_USER` (`admin`); email `STORE_ADMIN_EMAIL` (`admin@urumi.local`) | `STORE_ADMIN_PASSWORD` |
| **Customer** | Storefront | None needed; checkout works as a guest | — |

### Tokens the gateway issues

| Token | Looks like | Lifetime | Shown | Stored as |
| --- | --- | --- | --- | --- |
| **Member API key**, for external MCP clients | `mcpk_...` | Until revoked, or until its owner is disabled | Once, when created on **API keys** | SHA-256 hash |
| **Invite link** | `http://gateway.localhost:8080/invite/inv_...` | 7 days, single use | Once, after **Invite** on **Members** | SHA-256 hash |
| **Dashboard session** | `ses_...` | 12 hours | Never; kept in the browser under `gateway.session` | SHA-256 hash |

A client sends its key as `Authorization: Bearer mcpk_...` to `http://127.0.0.1:8080/mcp`.

### Service credentials (machine to machine)

All values come from `.local\platform-secrets.env` unless stated otherwise.

| Value | Kubernetes Secret | Used by | Purpose |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | `urumi-platform/gateway` | Gateway | Creates the first admin. Read only while no admin exists, so changing it later has no effect. |
| `POSTGRES_PASSWORD` | `urumi-platform/gateway` | Gateway, Postgres | Gateway database. Fixed after the first deploy. |
| `GATEWAY_ENCRYPTION_KEY` | `urumi-platform/gateway` | Gateway | AES-256-GCM key that encrypts server credentials saved through **Add server**. Never change it: saved credentials would become unreadable. |
| `LLM_API_KEY` | `urumi-platform/gateway` | Gateway (Chat) | Groq key. Optional; set with `create-local-secrets.ps1 -LlmApiKey`. |
| `MCP_UPSTREAM_TOKEN` | `urumi-platform/woo-mcp` | Gateway → WooCommerce adapter | Bearer token. The **WooCommerce** server card uses **Bearer token** auth. |
| `UTILS_MCP_API_KEY` | `urumi-platform/utils-mcp` | Gateway → Utilities server | Sent as the `X-Api-Key` header. The **Utilities** card uses **Custom header** auth. |
| `WOOCOMMERCE_CONSUMER_KEY` (`ck_...`), `WOOCOMMERCE_CONSUMER_SECRET` (`cs_...`) | `urumi-platform/woo-mcp`, `urumi/store-setup` | WooCommerce adapter → store REST API | WooCommerce API key "MCP adapter", registered in the store by the setup Job |
| `STORE_ADMIN_USER`, `STORE_ADMIN_PASSWORD`, `STORE_ADMIN_EMAIL` | `urumi/store-setup` | Store setup Job | WordPress admin account |
| `mysql-password`, `mysql-root-password` (in `.local\store-database.env`) | `urumi/store-database` | WordPress, MySQL | Store database |
| *(none)* | — | Gateway → Reference server | **None** auth. Only the gateway can reach it, enforced by NetworkPolicy. |

Users never see the service credentials. They connect only to the gateway, and the gateway adds the right
credential for each upstream.

### Printing a value

```powershell
# One value from the local file (swap the name as needed)
(Select-String .local\platform-secrets.env -Pattern '^ADMIN_PASSWORD=').Line.Split('=', 2)[1]

# The same value, read from the cluster
$b64 = kubectl --kubeconfig .local\kubeconfig -n urumi-platform get secret gateway -o jsonpath='{.data.ADMIN_PASSWORD}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
```

> Don't print secrets while screen-recording, and never paste them into docs, issues or chat.

### Rotating

| Credential | How |
| --- | --- |
| Member API key | **Revoke** it, then **Create key**. Takes effect immediately. |
| Member access | **Members → Disable** ends their sessions and stops all their keys |
| Groq key | Create a new key at Groq, run `.\scripts\create-local-secrets.ps1 -LlmApiKey '<new key>'`, then `kubectl --kubeconfig .local\kubeconfig -n urumi-platform rollout restart deployment gateway` |
| Database passwords, encryption key | Not rotated in place. To start fresh, reset everything ([section 8](#8-cleaning-up-and-resetting)) after deleting `.local\platform-secrets.env` and `.local\store-database.env`. |

## 4. Scenarios

### Scenario 1: A customer buys through the storefront

1. Open http://store.localhost:8080 → **Shop** → **Sample T-shirt** → **Add to cart**.
2. Open the cart → **Proceed to checkout**.
3. Fill in the billing details, choose **Cash on delivery**, then **Place order**.
4. Open http://store.localhost:8080/wp-admin → **WooCommerce → Orders**.

**Expected:** the new order is listed as **Processing**.
**Audit log:** nothing. The customer checks out directly with the store, not through the gateway.

### Scenario 2: User A creates a product through chat

1. As the admin, open **Chat** → **New chat**.
2. Send: `Create a simple product called Blue Mug priced at 499.`
3. The assistant describes the product and asks you to confirm. Send: `Yes, go ahead.`

**Expected:** the reply shows a tool trace with `woo__create_product` marked **ok**, and the
product appears in **wp-admin → Products**.
**Audit log:** `admin@urumi.local · Chat · WooCommerce · woo__create_product · success`.

> The assistant always asks before it creates or changes anything. That is deliberate.
> Every run creates a new product, even with the same name. Use a fresh name per run (for example
> `Green Mug`) so the product in scenario 3 is easy to tell apart.

### Scenario 3: A manual order is read back through chat

1. In wp-admin → **WooCommerce → Orders → Add order**, add **Blue Mug** with quantity 3,
   set the status to **Processing**, then **Create**. Note the order number.
2. In **Chat**, send: `Show me the most recent order for the Blue Mug: quantity and total.`

**Expected:** a trace with `woo__list_orders` and/or `woo__get_order`, and a reply with the order
number, quantity 3 and total ₹1,497.00.
**Audit log:** one `Chat` row per tool call, under the admin.

> Customer names and emails are left out of order results on purpose; the adapter strips them.

### Scenario 4: Invite User B

1. As the admin, open **Members**, enter an email that has not been used yet (for example `demo-b@urumi.local`),
   keep **Member**, then **Invite**. Nothing is actually emailed, so any address works.
2. Copy the invite link. It is shown only once.
3. In the **private window**, open the link, choose a name and a password of 12+ characters, then **Create account**.
4. As User B, open **API keys**, name the key (for example `laptop`), then **Create key**. Copy the key.

**Expected:** User B sees **Servers**, **Chat**, **API keys** and **Audit log**, but not **Members**.
The key starts with `mcpk_` and is never shown again.

### Scenario 5: User B connects an external MCP client

User B needs only two things: the gateway URL and the key copied in scenario 4. Keys are shown only once;
if it was lost, create another one on **API keys**.

> **Use `http://127.0.0.1:8080/mcp`.** The dashboard shows `http://gateway.localhost:8080/mcp`,
> which works in a browser, but Node-based clients on Windows cannot resolve `*.localhost`.

Pick one client:

| Client | How to connect |
| --- | --- |
| **Claude Code** | `claude mcp add --transport http urumi http://127.0.0.1:8080/mcp --header "Authorization: Bearer mcpk_..."` |
| **Claude Desktop, Cursor, VS Code** | Paste the JSON below into the client's MCP settings |
| **MCP Inspector** | `npx @modelcontextprotocol/inspector`, then choose **Streamable HTTP**, the URL, and an `Authorization: Bearer mcpk_...` header |

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

1. List the tools. You should see 31, including `woo__get_order` and `utils__convert_currency`.
2. Ask: `Get order <number from scenario 3>.` (order 20 in the 24 Oct run)

**Expected:** the order comes back through `woo__get_order`: 3 × Blue Mug, ₹1,497, Processing.
**Audit log:** `demo-b@urumi.local · MCP client · WooCommerce · woo__get_order · success`.

> Inspector and similar tools call tools directly. Clients with their own model (Claude Code, Claude
> Desktop, Cursor) pick the tool themselves from your question.

### Scenario 6: One prompt uses two servers

In User B's client (or in chat), ask:
`What is order <number> worth in euros?`

**Expected:** two tool calls, `woo__get_order` then `utils__convert_currency`. For order 20 (or 15):
₹1,497 ≈ €14.63. The rates are fixed demo values.
In Inspector, run the two tools by hand: `woo__get_order` with `{"order_id": 20}`, then
`utils__convert_currency` with `{"amount": 1497, "from": "INR", "to": "EUR"}`.
**Audit log:** two rows a second apart, on two different servers, both under User B.

### Scenario 7: Revoking a key cuts access immediately

1. As User B (or as the admin, under **Members → Show keys**), find the key (`laptop`) → **Revoke**.
2. In User B's client, make any tool call.

**Expected:** the call is refused with "This API key has been revoked." No waiting period, no restart.
**Audit log:** `denied · API key revoked or user disabled.`

### Scenario 8: Disabling a server hides its tools everywhere

1. As the admin, open **Servers** → **Utilities** → **Disable**.
2. In **Chat**, the header now reports 4 fewer tools (31 → 27).
3. In an external client, refresh the tool list (some clients need a reconnect). The `utils__*` tools are gone.
4. Ask the assistant to convert a currency. It reports that it can't.
5. Click **Enable** to restore the server.

**Expected:** the status changes to **Disabled**, and back to **Connected** once enabled.
**Audit log:** any call to a disabled server is recorded as `denied · Utilities is disabled.`

### Scenario 9: An outage stays isolated

1. Take the reference server down:
   ```powershell
   kubectl --kubeconfig .local\kubeconfig -n urumi-platform scale deployment everything-mcp --replicas=0
   ```
2. On **Servers**, click **Check now** on **Reference server**.
3. In **Chat**, ask about an order.
4. Bring it back:
   ```powershell
   kubectl --kubeconfig .local\kubeconfig -n urumi-platform scale deployment everything-mcp --replicas=1
   ```

**Expected:** **Reference server** shows **Unreachable** with the reason (for example `ECONNREFUSED`).
WooCommerce and Utilities keep working. Within about 15 seconds of restoring, it shows **Connected** again.

### Scenario 10: The audit log attributes every call

1. As the admin, open **Audit log**. It lists every call from every user.
2. As User B, open **Audit log**. It lists only User B's own calls.

**Expected:** each row shows the user, whether the call came from chat or an MCP client, the server,
the tool, the result and the duration. Chat calls from scenarios 2–3 sit under the admin; client calls from 5–7 sit under User B.

## 5. Extra scenarios

| Scenario | Do | Expected |
| --- | --- | --- |
| Name collision | Call `utils__echo` and `everything__echo` | Each reaches its own server; the utils reply says `"from":"utils"` |
| Timeout | Call `utils__sleep` with `{"seconds": 20}` | Fails after 15 s with "Utilities did not respond within 15s"; nothing else is affected |
| Unknown tool | Call `nope__x` | `denied`, with "Tool names look like <server>__<tool>" |
| Member limits | As User B, try to open `/members` | "Page not found"; the API refuses too |
| Single-use invite | Open an invite link a second time | Rejected |
| Duplicate invite | Invite an email that already has an account | "A user with this email already exists." Members are never deleted, only disabled. |
| Add a server | **Servers → Add server**, with slug, name, URL and auth (None, Bearer or Custom header) | The card appears, then shows Connected or Unreachable |
| Credentials stay hidden | **Edit** a server with a credential | The field is empty: "Leave empty to keep the saved value" |

## 6. Reading the audit log

| Column | Meaning |
| --- | --- |
| **Time** | When the gateway received the call (browser's local time) |
| **User** | Whose key or session made the call |
| **Via** | `Chat` (dashboard assistant) or `MCP client` (external, with a key) |
| **Server** | Upstream the call went to; `—` if it never got that far |
| **Tool** | The full exposed name, `<server>__<tool>` |
| **Result** | `success`; `error` (the upstream failed or timed out); `denied` (the gateway refused: revoked key, disabled server, unknown tool) |
| **Duration** | Time to the upstream and back |
| **Detail** | Reason for an `error` or `denied` |

Arguments and results are not stored, so customer data stays out of the log.

### Example: the log after verification on 24 Oct

| Time | Rows | What happened |
| --- | --- | --- |
| 02:07 | `b@urumi.local`: echo, convert, `nope__x` denied, `utils__sleep` error after 15 s | Routing, the unknown-tool rule and the timeout tested from a client |
| 02:08 | `b1792…@urumi.local`: create, list, convert, then `woo__list_orders` **denied** | Full member flow; the denied row is the call made after revoking the key |
| 02:13 | `admin@urumi.local`: `woo__get_order` | Storefront order 12 read back |
| 09:42 | admin, Chat: create and list **error** after 5 s | The store was cold after hours idle. The product was still created (see [Demo tips](#7-demo-tips)) |
| 09:43–09:46 | admin, Chat: list_orders, get_order, convert | Scenarios 3 and 6 in chat |
| 09:47 | `user-b@urumi.local`, MCP client: get_order, convert | Scenario 6 from an external agent |
| 10:28 | admin, Chat: `woo__create_product` **success** in 0.8 s | Demo run, scenario 2 (product 18) |
| 10:34 | admin, Chat: `woo__list_orders` | Demo run, scenario 3 (order 20 read back) |

Scenarios 1 and 4 add no rows: checkout goes straight to the store, and inviting members or creating keys
are not tool calls.

## 7. Demo tips

- **Warm the store first.** After a long idle, WordPress's first request can take about 9 s, and the adapter
  gives up after 5 s. Open the storefront once before recording. If a write does time out, check the store
  before retrying; the write has usually gone through.
- **Mind the free LLM tier.** Groq's free tier allows 8,000 tokens a minute, and a chat request with all 31 tools
  uses about 4,500. Leave about a minute between chat prompts, or disable **Reference server** while you
  demonstrate chat (it accounts for 22 of the 31 tools). The gateway waits out short limits by itself.
- **Be specific.** "About my order?" makes the assistant ask for an order number. "Show order 15" works straight away.
- **Use two windows** so User A and User B stay signed in at the same time.
- **Ignore "Draft" orders.** Opening **Add order** in wp-admin reserves an order number (order 19 in the
  24 Oct run). It never becomes a real order, and WordPress removes it after a week.

## 8. Cleaning up and resetting

| Goal | How |
| --- | --- |
| Reuse an email after testing | Not possible. Invite a new address, or reset the gateway (below). |
| Remove a test member | **Members → Disable**. This ends their sessions and stops their keys. Members are disabled, not deleted, so the audit history stays intact. |
| Remove a key | **API keys → Revoke**. Revoke any key that has appeared in a screenshot or recording. |
| Remove test products or orders | In wp-admin, move them to the trash |
| Reset the gateway only (users, keys, servers, audit) | `kubectl --kubeconfig .local\kubeconfig -n urumi-platform delete pvc data-gateway-postgres-0`, then delete pod `gateway-postgres-0` and restart the gateway |
| Reset everything | `.\.local\tools\k3d.exe cluster delete urumi`, then run the four setup scripts again ([STATUS.md §3](STATUS.md#3-getting-started)). The passwords in `.local\` are kept. |

Data in the system after the 24 Oct run:

| Kind | From earlier verification | From the demo run |
| --- | --- | --- |
| Products | 10 Sample T-shirt (seeded), 11 E2E Mug…, 13 Blue Mug | 18 Blue Mug |
| Orders | 12 (storefront), 15 (manual, 3 × Blue Mug) | 16 (storefront), 20 (manual, 3 × Blue Mug), 19 (draft, ignore) |
| Members | `b@urumi.local`, `b1792787882685@urumi.local`, `user-b@urumi.local` | `demo-b@urumi.local` ("User C") |
| Keys | `laptop` (b@), `external agent` (user-b@), revoked: `external client`, `order check` | `laptop` (demo-b@); admin's `sample`, to be revoked |

## 9. Recording checklist

- [ ] Store warmed up, all three servers **Connected**
- [ ] Two browser windows ready (admin, private for User B)
- [ ] An external client installed, with `http://127.0.0.1:8080/mcp` ready to paste
- [ ] Scenarios 1–10 in order, about a minute apart for chat
- [ ] Afterwards: revoke every key shown on screen, and rotate the Groq key

## 10. Run log

Results of each demo run, checked against the store and gateway databases, not only the screen.

### Run 1: 24 Oct 2026 (in progress)

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Customer buys through the storefront | Passed | Order **16**, 10:21: 1 × Sample T-shirt, ₹499, Cash on delivery, Processing, created via the storefront |
| 2 | Admin creates a product through chat | Passed | Product **18** "Blue Mug", ₹499. Audit 10:28: `woo__create_product` success in 0.8 s |
| 3 | Manual order read back through chat | Passed | Order **20**, 10:32: 3 × Blue Mug, ₹1,497, Processing, created in wp-admin. Audit 10:34: `woo__list_orders` success |
| 4 | Invite User B | Passed | `demo-b@urumi.local` invited 10:45, accepted as "User C"; key `laptop` created 10:47, not used yet |
| 5 | External MCP client | Next | Use the `laptop` key and order 20 |
| 6 | One prompt, two servers | To do | Order 20 → expect €14.63 |
| 7 | Revoke a key | To do | Revoke `laptop` |
| 8 | Disable a server | To do | |
| 9 | Outage isolation | To do | |
| 10 | Audit attribution | To do | |

Notes from this run:
- The first invite used `user-b@urumi.local`, which was already taken from earlier testing. It was
  rejected as expected, and `demo-b@urumi.local` was used instead.
- There are now two products named "Blue Mug" (13 and 18). Both cost ₹499, so the totals are unaffected.
- Order 19 is a draft left by opening **Add order**; ignore it.
