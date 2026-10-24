# Urumi MCP Gateway Bootcamp — Part 2 of 5
## The gateway backend: auth, hashed keys, upstream registry, MCP client pool, router, audit, one `/mcp` endpoint

> **Format**: freeCodeCamp-style. Small lessons. Type (or have Codex type) every line. Validate. Move on.
>
> **Starting point**: Part 1 read. The adapter works at `http://127.0.0.1:3001/mcp`. Docker Desktop is running.
>
> **End state of Part 2**: A NestJS gateway in `gateway/` that runs on your laptop against a local Postgres. Admin login, invites, member API keys (hashed, revocable), three registered upstreams (woo, utils, everything), aggregated and namespaced tools, routing with timeouts, failure isolation, an audit row for every call, and a single stateless `/mcp` endpoint that MCP Inspector and Claude Code can use with a member key.
>
> **Time**: ~12–14 hours (Thu evening + Fri).

---

## Table of Contents — Part 2

| Phase | Title | What you'll build |
| --- | --- | --- |
| Phase 5 | Scaffold the gateway | Folder, packages, tsconfig, local Postgres |
| Phase 6 | Config, database, health | Env validation, schema, `/healthz`, `/readyz`, boot sequence |
| Phase 7 | Crypto toolbox | scrypt, SHA-256 tokens, AES-256-GCM, unit tests |
| Phase 8 | Users, sessions, invites | Admin seed, login, roles, guards, invite links |
| Phase 9 | API keys | `mcpk_…` keys, hashed storage, instant revocation |
| Phase 10 | Upstream registry | CRUD, encrypted credentials, SSRF guard, seeding |
| Phase 11 | MCP client pool + health | Connections to upstreams, timeouts, status snapshots |
| Phase 12 | Tool router + audit log | Namespacing, routing, failure isolation, audit rows |
| Phase 13 | The `/mcp` endpoint + two more upstreams | Stateless MCP server, utils server, everything server, Inspector + Claude Code |

**Final layout after Part 2:**

```
urumi-mcp-gateway/
├── src/ test/ charts/store/ scripts/ …        ← existing adapter + store (untouched)
├── gateway/
│   ├── package.json  tsconfig.json  tsconfig.build.json  .env.example  .env (gitignored)
│   ├── scripts/smoke-gateway.ts
│   ├── test/crypto.test.ts  test/tool-names.test.ts  test/ssrf.test.ts
│   └── src/
│       ├── main.ts  app.module.ts  config.ts  bootstrap.service.ts  health.controller.ts
│       ├── common/crypto.ts  common/validation.ts
│       ├── db/schema.ts  db/db.service.ts
│       ├── auth/auth.types.ts  auth.service.ts  auth.guards.ts  current-user.decorator.ts
│       │        auth.controller.ts  members.controller.ts
│       ├── keys/keys.service.ts  keys.controller.ts
│       ├── upstreams/ssrf.ts  tool-names.ts  upstream-errors.ts  upstreams.service.ts
│       │             upstream-pool.ts  upstream-health.service.ts  upstreams.controller.ts
│       ├── audit/audit.service.ts  audit.controller.ts
│       ├── router/tool-router.service.ts
│       └── mcp/mcp.controller.ts
└── mcp-servers/
    ├── utils/      package.json  server.mjs
    └── everything/ Dockerfile        (used in Part 4)
```

> 🧠 **Intuition — why a separate `gateway/` folder instead of rewriting the repo?**
> You're three days from a deadline and the adapter *works*. Moving it would break its scripts, tests and launcher. Leaving the adapter at the root and adding sibling apps is the lowest-risk monorepo. In the interview: "Each deployable has its own `package.json` and image. I kept the working adapter where it was to avoid churn."

---

# PHASE 5
## Scaffold the gateway

### Lesson 5.1 — Create the folder and install packages

⏱ ~15 min — **Goal:** An empty TypeScript project with every dependency installed

> 💡 **Why now?**
> Getting the project skeleton right once (ESM, strict TS, decorators) stops a whole class of weird errors later. Mirror your adapter's settings because they're already proven on your machine.

**Step 1.** From the repo root:

```powershell
PS> mkdir gateway, gateway\src, gateway\test, gateway\scripts
PS> cd gateway
PS> npm init -y
```

**Step 2.** Install runtime dependencies. Pin NestJS to the **same version as your adapter** (check the root `package.json`):

```powershell
PS> npm install @nestjs/common@12.2.0 @nestjs/core@12.2.0 @nestjs/platform-express@12.2.0 reflect-metadata@0.2.2 rxjs@7.8.2 zod@4.6.7 pg @modelcontextprotocol/sdk
PS> npm install --save-dev typescript@7.0.2 tsx @types/node @types/express @types/pg
```

> 🎤 **Interview angle — "Why `@modelcontextprotocol/sdk` 1.x in the gateway when the adapter uses the 2.x split packages?"**
> "The gateway needs the low-level `Server` (because aggregated tool schemas are dynamic JSON Schema, not Zod) plus `Client` and both Streamable HTTP transports. The 1.x package has all four in one well-documented, battle-tested package. The protocol on the wire is identical. Client and server negotiate the protocol version during `initialize`, so a 1.x gateway talks to a 2.x adapter without trouble. Each service owns its dependencies."

**Step 3.** Replace `gateway/package.json` with this (keep the `dependencies` / `devDependencies` blocks npm wrote, and replace everything else):

```json
{
  "name": "urumi-gateway",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "dev": "tsx watch --env-file=.env src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "tsx --test test/*.test.ts",
    "smoke": "tsx scripts/smoke-gateway.ts"
  }
}
```

**Step 4.** Create `gateway/tsconfig.json`. **Compare it with your root `tsconfig.json` and copy any setting that differs** (especially `target`, `module`, `moduleResolution`):

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test", "scripts"]
}
```

**Step 5.** Create `gateway/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

**Step 6.** Add to the **root** `.gitignore` (so it covers the new folders):

```gitignore
# gateway + dashboard + mcp-servers
gateway/node_modules/
gateway/dist/
gateway/.env
dashboard/node_modules/
dashboard/dist/
mcp-servers/*/node_modules/
.local/
```

> ✅ **Validate**
> `npx tsc --version` inside `gateway/` prints 7.0.2. `git status` doesn't show `node_modules`.

> ⚠️ **Heads up**
> - If `npm install` for `@nestjs/*@12.2.0` fails, use exactly what the root `package-lock.json` resolved (`npm ls @nestjs/core` at the root).
> - **ESM rule:** every relative import in this project ends in `.js`, even though the file is `.ts` (`import { X } from './x.js'`). This is how `NodeNext` resolution works. Missing `.js` gives "Cannot find module".

---

### Lesson 5.2 — Run a local Postgres for development

⏱ ~5 min — **Goal:** A throwaway database on port 5433 (5432 may be busy)

```powershell
PS> docker run -d --name gateway-pg -e POSTGRES_USER=gateway -e POSTGRES_PASSWORD=gateway -e POSTGRES_DB=gateway -p 5433:5432 postgres:16-alpine
PS> docker exec -it gateway-pg psql -U gateway -d gateway -c "select version();"
```

> ✅ **Validate**
> `psql` prints a PostgreSQL 16 version string.

> 💡 **What just happened?**
> Same trick as TaskFlow Phase 4: you *use* Docker for a dependency while developing. In Part 4 this becomes a StatefulSet with a PVC in the cluster, and the code doesn't change, only `DATABASE_URL`.

---

# PHASE 6
## Config, database, health, and the boot sequence

### Lesson 6.1 — `config.ts`: fail fast on bad configuration

⏱ ~15 min — **Goal:** One typed object holding every setting, validated at startup

> 💡 **Why now?**
> In Kubernetes, a missing Secret key should crash the pod *at startup* with a clear message (`CrashLoopBackOff` + a readable log), not at 2 AM on the first tool call. Everything else reads config from this one object.

Create `gateway/src/config.ts`:

```typescript
// gateway/src/config.ts
export const CONFIG = Symbol('CONFIG');

export type AuthType = 'none' | 'bearer' | 'header';

export interface SeedUpstream {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  headerName?: string;
  /** Name of the env var that holds this upstream's credential (never the secret itself). */
  secretEnv?: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  encryptionKey: Buffer;
  publicUrl: string;
  adminEmail: string | null;
  adminPassword: string | null;
  timezone: string;
  callTimeoutMs: number;
  listTimeoutMs: number;
  healthIntervalMs: number;
  allowPrivateUpstreams: boolean;
  upstreamAllowHosts: string[];
  seedUpstreams: SeedUpstream[];
  llm: LlmConfig | null;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function required(name: string): string {
  const value = optional(name);
  if (value === null) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseSeeds(raw: string | null): SeedUpstream[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SEED_UPSTREAMS must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('SEED_UPSTREAMS must be a JSON array');
  return parsed as SeedUpstream[];
}

export function loadConfig(): AppConfig {
  const encryptionKey = Buffer.from(required('GATEWAY_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error('GATEWAY_ENCRYPTION_KEY must be 32 random bytes, base64-encoded');
  }

  const timezone = optional('TIMEZONE') ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`TIMEZONE "${timezone}" is not a valid IANA timezone`);
  }

  const llmBaseUrl = optional('LLM_BASE_URL');
  const llmModel = optional('LLM_MODEL');
  const llmApiKey = optional('LLM_API_KEY');

  return {
    port: int('PORT', 3000, 1, 65535),
    databaseUrl: required('DATABASE_URL'),
    encryptionKey,
    publicUrl: (optional('PUBLIC_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    adminEmail: optional('ADMIN_EMAIL')?.toLowerCase() ?? null,
    adminPassword: optional('ADMIN_PASSWORD'),
    timezone,
    callTimeoutMs: int('CALL_TIMEOUT_MS', 15_000, 1_000, 120_000),
    listTimeoutMs: int('LIST_TIMEOUT_MS', 4_000, 500, 60_000),
    healthIntervalMs: int('HEALTH_INTERVAL_MS', 15_000, 2_000, 600_000),
    allowPrivateUpstreams: optional('ALLOW_PRIVATE_UPSTREAMS') === 'true',
    upstreamAllowHosts: (optional('UPSTREAM_ALLOW_HOSTS') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    seedUpstreams: parseSeeds(optional('SEED_UPSTREAMS')),
    llm:
      llmBaseUrl && llmModel && llmApiKey
        ? { baseUrl: llmBaseUrl.replace(/\/+$/, ''), model: llmModel, apiKey: llmApiKey }
        : null,
  };
}
```

**Step 2.** Generate an encryption key and an admin password:

```powershell
PS> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
PS> node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

**Step 3.** Create `gateway/.env.example` (committed, placeholders only):

```ini
PORT=3000
DATABASE_URL=postgres://gateway:gateway@127.0.0.1:5433/gateway
# 32 random bytes, base64: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
GATEWAY_ENCRYPTION_KEY=
PUBLIC_URL=http://localhost:5173
ADMIN_EMAIL=admin@urumi.local
ADMIN_PASSWORD=
TIMEZONE=Asia/Kolkata
CALL_TIMEOUT_MS=15000
LIST_TIMEOUT_MS=4000
HEALTH_INTERVAL_MS=15000
# Local dev only: lets admins register 127.0.0.1 upstreams. Always false in Kubernetes.
ALLOW_PRIVATE_UPSTREAMS=true
UPSTREAM_ALLOW_HOSTS=
# Upstream credentials (the gateway encrypts them into the DB on first boot)
WOO_MCP_TOKEN=
UTILS_MCP_API_KEY=
SEED_UPSTREAMS='[{"slug":"woo","name":"WooCommerce Store","url":"http://127.0.0.1:3001/mcp","authType":"bearer","secretEnv":"WOO_MCP_TOKEN"},{"slug":"utils","name":"Utilities","url":"http://127.0.0.1:3002/mcp","authType":"header","headerName":"X-Api-Key","secretEnv":"UTILS_MCP_API_KEY"}]'
# OpenAI-compatible chat completions endpoint (Part 3). For Ollama use LLM_API_KEY=ollama.
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
LLM_API_KEY=
```

**Step 4.** Copy it to `gateway/.env` and fill in `GATEWAY_ENCRYPTION_KEY`, `ADMIN_PASSWORD` (at least 12 characters), and `WOO_MCP_TOKEN` = **the same bearer token your adapter's `.env` uses**. Choose any long random value for `UTILS_MCP_API_KEY` (you'll give the same value to the utils server in Phase 13).

> ✅ **Validate**
> `gateway/.env` exists and `git status` does **not** list it.

> 💡 **What just happened?**
> Notice `SeedUpstream.secretEnv`: the seed config names an env var, never the secret itself. So the seed JSON can live in a Helm values file (non-secret) while the actual token comes from a Kubernetes Secret.

---

### Lesson 6.2 — Schema and `DbService`

⏱ ~20 min — **Goal:** All tables created idempotently on boot, safely even with 2 replicas

> 🧠 **Intuition — the advisory lock**
> If two gateway pods boot at the same moment, both run `CREATE TABLE IF NOT EXISTS`, and Postgres can still throw a race error. An *advisory lock* is a "talking stick": only the pod holding it runs migrations, and the other waits, then finds everything already exists.

**Step 1.** Create `gateway/src/db/schema.ts`:

```typescript
// gateway/src/db/schema.ts
// Idempotent schema. Every statement is safe to run on every boot.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'member')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS upstreams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  url              text NOT NULL,
  auth_type        text NOT NULL CHECK (auth_type IN ('none', 'bearer', 'header')),
  auth_header_name text,
  auth_secret_enc  text,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  user_id       uuid,
  user_email    text NOT NULL,
  source        text NOT NULL CHECK (source IN ('mcp', 'chat')),
  upstream_id   uuid,
  upstream_name text,
  tool_name     text NOT NULL,
  duration_ms   integer NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('success', 'error', 'denied')),
  detail        text
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_at ON audit_log (user_id, at DESC);

CREATE TABLE IF NOT EXISTS bootstrap_state (
  key        text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
```

**Step 2.** Create `gateway/src/db/db.service.ts`:

```typescript
// gateway/src/db/db.service.ts
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type AppConfig } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

const MIGRATION_LOCK_ID = 727_274;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  }

  async query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /** Runs the idempotent schema under an advisory lock so concurrent replicas don't race. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
```

> 🎤 **Interview angle — "Why no ORM / migration framework?"**
> "Six tables, all additive. Plain SQL with `IF NOT EXISTS`, run under an advisory lock at boot, is the simplest thing that's correct, and I can show you every query. In TaskFlow I used TypeORM migrations. For a schema that will evolve with a team, I'd move to versioned migrations again."

> 💡 **What just happened?**
> Design notes worth saying out loud:
> - `audit_log.user_email` and `upstream_name` are **denormalized** on purpose: the log stays readable even if a server is deleted later. Audit logs are history, not live joins.
> - `audit_log.user_id` has **no foreign key**: deleting things must never be blocked by, or cascade into, the audit trail.
> - `api_keys.key_hash UNIQUE` gives an index, so authentication is one indexed lookup per request.

---

### Lesson 6.3 — Health endpoints, boot sequence, and the first run

⏱ ~15 min — **Goal:** `npm run dev` boots, migrates, and answers `/healthz` + `/readyz`

**Step 1.** Create `gateway/src/health.controller.ts`:

```typescript
// gateway/src/health.controller.ts
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from './db/db.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Liveness: the process is up. Deliberately does NOT touch the database. */
  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  /** Readiness: can we serve real traffic right now? */
  @Get('readyz')
  async readyz() {
    try {
      await this.db.ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }
}
```

**Step 2.** Create `gateway/src/bootstrap.service.ts` (first version: it only migrates. Phases 8 and 10 grow it):

```typescript
// gateway/src/bootstrap.service.ts  (Phase 6 version)
import { Inject, Injectable } from '@nestjs/common';
import { DbService } from './db/db.service.js';

@Injectable()
export class BootstrapService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async run(): Promise<void> {
    await this.db.migrate();
    console.log('[bootstrap] schema ready');
  }
}
```

**Step 3.** Create `gateway/src/app.module.ts`:

```typescript
// gateway/src/app.module.ts  (Phase 6 version, grows every phase)
import { Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { BootstrapService } from './bootstrap.service.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [{ provide: CONFIG, useFactory: loadConfig }, DbService, BootstrapService],
})
export class AppModule {}
```

**Step 4.** Create `gateway/src/main.ts`:

```typescript
// gateway/src/main.ts  (Phase 6 version)
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { BootstrapService } from './bootstrap.service.js';
import { CONFIG, type AppConfig } from './config.js';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  await app.init();
  await app.get(BootstrapService).run();

  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.port, '0.0.0.0');
  console.log(`[gateway] listening on :${config.port}`);
}

main().catch((err: unknown) => {
  console.error('[gateway] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

**Step 5.** Run it:

```powershell
PS> cd gateway
PS> npm run dev
```

**Step 6.** In another terminal:

```powershell
PS> Invoke-RestMethod http://localhost:3000/healthz
PS> Invoke-RestMethod http://localhost:3000/readyz
PS> docker exec -it gateway-pg psql -U gateway -d gateway -c "\dt"
```

> ✅ **Validate**
> Logs show `[bootstrap] schema ready` and `[gateway] listening on :3000`. Both endpoints return JSON. `\dt` lists `api_keys, audit_log, bootstrap_state, invites, sessions, upstreams, users`.
>
> Now stop Postgres (`docker stop gateway-pg`): `/healthz` still says ok, and `/readyz` returns **503**. Start it again (`docker start gateway-pg`) and `/readyz` recovers. **That's the liveness vs readiness lesson, live.**

> ⚠️ **Heads up**
> - `Nest can't resolve dependencies of DbService (?)`: you forgot `@Inject(CONFIG)` in a constructor. With `tsx`, decorator type metadata isn't emitted, so **every constructor parameter needs an explicit `@Inject(...)`**. That's why every class in this bootcamp has one. (Your adapter does the same.)
> - `TS1272: A type referenced in a decorated signature must be imported with 'import type'`: change `import { AppConfig }` to `import { type AppConfig }`.
> - `Missing required environment variable …`: the `.env` file isn't loaded. Check the `--env-file=.env` flag in the `dev` script, and that you're inside `gateway/`.
> - `app.useBodyParser is not a function`: your Nest version needs `NestFactory.create<NestExpressApplication>(…)` (typed as Express), as above.

> 💡 **What just happened?**
> The boot order is explicit: **create → init → migrate + seed → listen**. The pod only accepts traffic after the schema exists. No hidden lifecycle-hook ordering to reason about.

---

# PHASE 7
## Crypto toolbox

### Lesson 7.1 — `crypto.ts` + validation helper

⏱ ~20 min — **Goal:** Every security primitive in one small, tested file

> 🧠 **Intuition**
> Recap from Part 1: passwords get a **slow fingerprint** (scrypt). Random tokens get a **fast fingerprint** (SHA-256). Upstream credentials go in a **safe** (AES-GCM) because we need them back.

**Step 1.** Create `gateway/src/common/crypto.ts`:

```typescript
// gateway/src/common/crypto.ts
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** 256 bits of randomness with a readable prefix, e.g. mcpk_…, ses_…, inv_… */
export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** Fast hash for HIGH-entropy secrets (API keys, session and invite tokens). */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Slow, salted hash for LOW-entropy secrets (passwords). Format: scrypt$<salt>$<key> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltB64, keyB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** AES-256-GCM. Format: v1:<iv>:<authTag>:<ciphertext> (base64 parts). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(blob: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = blob.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('Unsupported encrypted secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

**Step 2.** Create `gateway/src/common/validation.ts`:

```typescript
// gateway/src/common/validation.ts
import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validate an untrusted request body with Zod and turn failures into a readable 400. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
    );
  }
  return result.data;
}
```

**Step 3.** Create `gateway/test/crypto.test.ts`:

```typescript
// gateway/test/crypto.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from '../src/common/crypto.js';

test('password hashing verifies the right password only', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  assert.notEqual(await hashPassword('same'), await hashPassword('same'), 'salted hashes differ');
});

test('tokens are prefixed, unique, and hash deterministically', () => {
  const a = randomToken('mcpk_');
  assert.ok(a.startsWith('mcpk_'));
  assert.notEqual(a, randomToken('mcpk_'));
  assert.equal(sha256(a), sha256(a));
  assert.equal(sha256(a).length, 64);
});

test('AES-GCM round-trips and detects tampering', () => {
  const key = randomBytes(32);
  const blob = encryptSecret('super-secret-token', key);
  assert.equal(decryptSecret(blob, key), 'super-secret-token');
  assert.notEqual(encryptSecret('super-secret-token', key), blob, 'fresh IV every time');

  const parts = blob.split(':');
  const data = Buffer.from(parts[3]!, 'base64');
  data[0] = data[0]! ^ 0xff;
  parts[3] = data.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), key));
  assert.throws(() => decryptSecret(blob, randomBytes(32)), 'wrong key fails');
});
```

> ✅ **Validate**
> ```powershell
> PS> npm test
> ```
> 3 tests pass.

> 💡 **What just happened?**
> The tamper test is the AES-**GCM** promise: flip one bit and decryption throws instead of returning garbage. That's the "authenticated" in authenticated encryption, and it's exactly what you'd point at in an interview.

---

# PHASE 8
## Users, sessions, invites, roles

### Lesson 8.1 — Types, `AuthService`, guards and the `@CurrentUser()` decorator

⏱ ~40 min — **Goal:** Login, logout, "me", invites, member management

> 💡 **Why now?**
> Everything after this needs to know *who* is calling: the audit log, key ownership, admin-only routes, and the chat agent acting as a user. Identity comes first.

**Step 1.** Create `gateway/src/auth/auth.types.ts`:

```typescript
// gateway/src/auth/auth.types.ts
import type { Request } from 'express';

export type Role = 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type AuthedRequest = Request & { user?: AuthUser };

export function toAuthUser(row: { id: string; email: string; name: string; role: string }): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role === 'admin' ? 'admin' : 'member' };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
```

**Step 2.** Create `gateway/src/auth/auth.service.ts`:

```typescript
// gateway/src/auth/auth.service.ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../common/crypto.js';
import { toAuthUser, type AuthUser, type Role } from './auth.types.js';

const SESSION_TTL_HOURS = 12;
const INVITE_TTL_DAYS = 7;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'disabled';
  password_hash: string;
}

@Injectable()
export class AuthService {
  /** Used to spend the same scrypt time whether or not the email exists (no user enumeration by timing). */
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.dummyHash = hashPassword(randomToken('dummy_'));
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const row = await this.db.one<UserRow>(
      'SELECT id, email, name, role, status, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()],
    );
    const passwordOk = await verifyPassword(password, row?.password_hash ?? (await this.dummyHash));
    if (!row || !passwordOk || row.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const user = toAuthUser(row);
    return { token: await this.createSession(user.id), user };
  }

  async createSession(userId: string): Promise<string> {
    const token = randomToken('ses_');
    await this.db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [userId, sha256(token), SESSION_TTL_HOURS],
    );
    return token;
  }

  async userForSession(token: string): Promise<AuthUser | null> {
    if (!token.startsWith('ses_')) return null;
    const row = await this.db.one<UserRow>(
      `SELECT u.id, u.email, u.name, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
      [sha256(token)],
    );
    return row ? toAuthUser(row) : null;
  }

  async logout(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }

  async createInvite(actor: AuthUser, email: string, role: Role) {
    const normalized = email.toLowerCase();
    const existing = await this.db.one('SELECT id FROM users WHERE email = $1', [normalized]);
    if (existing) throw new ConflictException('A user with this email already exists');

    const token = randomToken('inv_');
    const row = await this.db.one<{ id: string; expires_at: Date }>(
      `INSERT INTO invites (email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
       RETURNING id, expires_at`,
      [normalized, role, sha256(token), actor.id, INVITE_TTL_DAYS],
    );
    // The raw token exists only in this response. The DB keeps its hash.
    return {
      id: row!.id,
      email: normalized,
      role,
      inviteUrl: `${this.config.publicUrl}/invite/${token}`,
      expiresAt: row!.expires_at.toISOString(),
    };
  }

  async acceptInvite(token: string, name: string, password: string) {
    // Atomic claim: only one request can flip accepted_at from NULL.
    const invite = await this.db.one<{ id: string; email: string; role: Role }>(
      `UPDATE invites SET accepted_at = now()
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        RETURNING id, email, role`,
      [sha256(token)],
    );
    if (!invite) throw new BadRequestException('Invite is invalid, expired or already used');

    const passwordHash = await hashPassword(password);
    const row = await this.db
      .one<UserRow>(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role, status`,
        [invite.email, name, invite.role, passwordHash],
      )
      .catch((err: { code?: string }) => {
        if (err.code === '23505') throw new ConflictException('A user with this email already exists');
        throw err;
      });
    const user = toAuthUser(row!);
    return { token: await this.createSession(user.id), user };
  }

  listMembers() {
    return this.db.query(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at AS "createdAt",
              count(k.id) FILTER (WHERE k.revoked_at IS NULL)::int AS "activeKeys",
              max(k.last_used_at) AS "lastKeyUseAt"
         FROM users u LEFT JOIN api_keys k ON k.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at`,
    );
  }

  listPendingInvites() {
    return this.db.query(
      `SELECT id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"
         FROM invites WHERE accepted_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
    );
  }

  async updateMember(actor: AuthUser, id: string, patch: { role?: Role; status?: 'active' | 'disabled' }) {
    if (id === actor.id) throw new BadRequestException('You cannot change your own role or status');
    const row = await this.db.one(
      `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status)
        WHERE id = $1 RETURNING id, email, name, role, status`,
      [id, patch.role ?? null, patch.status ?? null],
    );
    if (!row) throw new NotFoundException('User not found');
    if (patch.status === 'disabled') {
      await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    }
    return row;
  }
}
```

**Step 3.** Create `gateway/src/auth/auth.guards.ts`:

```typescript
// gateway/src/auth/auth.guards.ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { bearerToken, type AuthedRequest } from './auth.types.js';

/** Dashboard routes: requires a valid, unexpired session token (ses_…). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    const user = token ? await this.auth.userForSession(token) : null;
    if (!user) throw new UnauthorizedException('Please sign in');
    req.user = user;
    return true;
  }
}

/** Must run AFTER SessionGuard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== 'admin') throw new ForbiddenException('Admins only');
    return true;
  }
}
```

**Step 4.** Create `gateway/src/auth/current-user.decorator.ts`:

```typescript
// gateway/src/auth/current-user.decorator.ts
import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from './auth.types.js';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException();
  return req.user;
});
```

**Step 5.** Create `gateway/src/auth/auth.controller.ts`:

```typescript
// gateway/src/auth/auth.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './auth.guards.js';
import { CurrentUser } from './current-user.decorator.js';
import { bearerToken, type AuthUser } from './auth.types.js';

const LoginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

const AcceptInviteSchema = z.strictObject({
  token: z.string().startsWith('inv_').max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(12, 'password must be at least 12 characters').max(200),
});

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = parseBody(LoginSchema, body);
    return this.auth.login(email, password);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request) {
    const token = bearerToken(req);
    if (token) await this.auth.logout(token);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(@Body() body: unknown) {
    const { token, name, password } = parseBody(AcceptInviteSchema, body);
    return this.auth.acceptInvite(token, name, password);
  }
}
```

**Step 6.** Create `gateway/src/auth/members.controller.ts` (Phase 9 adds the key routes):

```typescript
// gateway/src/auth/members.controller.ts  (Phase 8 version)
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/validation.js';
import { AuthService } from './auth.service.js';
import { AdminGuard, SessionGuard } from './auth.guards.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthUser } from './auth.types.js';

const InviteSchema = z.strictObject({
  email: z.email().max(254),
  role: z.enum(['admin', 'member']).default('member'),
});

const UpdateMemberSchema = z.strictObject({
  role: z.enum(['admin', 'member']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

@Controller('api/members')
@UseGuards(SessionGuard, AdminGuard)
export class MembersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listMembers();
  }

  @Get('invites')
  invites() {
    return this.auth.listPendingInvites();
  }

  @Post('invites')
  invite(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const { email, role } = parseBody(InviteSchema, body);
    return this.auth.createInvite(actor, email, role);
  }

  @Patch(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.auth.updateMember(actor, id, parseBody(UpdateMemberSchema, body));
  }
}
```

**Step 7.** Replace `gateway/src/bootstrap.service.ts`, which now seeds the first admin:

```typescript
// gateway/src/bootstrap.service.ts  (Phase 8 version)
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { hashPassword } from './common/crypto.js';

@Injectable()
export class BootstrapService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async run(): Promise<void> {
    await this.db.migrate();
    await this.seedAdmin();
    console.log('[bootstrap] done');
  }

  private async seedAdmin(): Promise<void> {
    const row = await this.db.one<{ count: number }>(
      "SELECT count(*)::int AS count FROM users WHERE role = 'admin'",
    );
    if ((row?.count ?? 0) > 0) return;

    const { adminEmail, adminPassword } = this.config;
    if (!adminEmail || !adminPassword) {
      console.warn('[bootstrap] no admin exists and ADMIN_EMAIL / ADMIN_PASSWORD are not set');
      return;
    }
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

    await this.db.query(
      `INSERT INTO users (email, name, role, password_hash)
       VALUES ($1, 'Admin', 'admin', $2) ON CONFLICT (email) DO NOTHING`,
      [adminEmail, await hashPassword(adminPassword)],
    );
    console.log(`[bootstrap] created first admin ${adminEmail}`);
  }
}
```

**Step 8.** Update `gateway/src/app.module.ts`:

```typescript
// gateway/src/app.module.ts  (Phase 8 version)
import { Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { BootstrapService } from './bootstrap.service.js';
import { HealthController } from './health.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { MembersController } from './auth/members.controller.js';

@Module({
  controllers: [HealthController, AuthController, MembersController],
  providers: [{ provide: CONFIG, useFactory: loadConfig }, DbService, BootstrapService, AuthService],
})
export class AppModule {}
```

> ✅ **Validate — the two-user setup you'll reuse all bootcamp**
> Restart `npm run dev`, then:
> ```powershell
> PS> $base = "http://localhost:3000"
> PS> $adminPw = "<your ADMIN_PASSWORD>"
> PS> $login = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType "application/json" -Body (@{ email = "admin@urumi.local"; password = $adminPw } | ConvertTo-Json)
> PS> $adminH = @{ Authorization = "Bearer $($login.token)" }
> PS> Invoke-RestMethod "$base/api/auth/me" -Headers $adminH
>
> # Invite user A and user B
> PS> $invA = Invoke-RestMethod -Method Post "$base/api/members/invites" -Headers $adminH -ContentType "application/json" -Body (@{ email = "usera@urumi.local"; role = "member" } | ConvertTo-Json)
> PS> $invB = Invoke-RestMethod -Method Post "$base/api/members/invites" -Headers $adminH -ContentType "application/json" -Body (@{ email = "userb@urumi.local"; role = "member" } | ConvertTo-Json)
> PS> $invB.inviteUrl
>
> # User B accepts
> PS> $tokB = $invB.inviteUrl.Split('/')[-1]
> PS> $b = Invoke-RestMethod -Method Post "$base/api/auth/accept-invite" -ContentType "application/json" -Body (@{ token = $tokB; name = "User B"; password = "user-b-password-123" } | ConvertTo-Json)
> PS> $bH = @{ Authorization = "Bearer $($b.token)" }
> PS> Invoke-RestMethod "$base/api/auth/me" -Headers $bH
>
> # B is NOT an admin → 403
> PS> Invoke-RestMethod "$base/api/members" -Headers $bH
> ```
> `me` returns the admin, then user B. The last call fails with **403 Admins only**. Accepting the same invite twice fails with 400.

> ⚠️ **Heads up**
> - A **wrong password and an unknown email return the same 401 message**, and take the same time (the `dummyHash` trick). That's the TaskFlow user-enumeration lesson, upgraded.
> - `make_interval(hours => $3)` errors on Postgres < 13? You're on 16, so it's fine.
> - Accept-invite with a short password → 400 listing `password: password must be at least 12 characters`. That's `parseBody` working.

> 💡 **What just happened?**
> - **Invites are links, not emails.** The admin copies the URL to the teammate. Sending email is out of scope, and the README says so.
> - The invite token is **claimed atomically** with `UPDATE … WHERE accepted_at IS NULL RETURNING`, so two simultaneous clicks can't create two accounts.
> - **Disabling a user deletes their sessions**, and (Phase 9) their keys stop working because key auth checks `users.status`.

---

# PHASE 9
## API keys

### Lesson 9.1 — `KeysService`: create, list, revoke, authenticate

⏱ ~30 min — **Goal:** Members generate personal keys, admins can issue and revoke anyone's

> 🧠 **Intuition — the coat-check ticket**
> When you check your coat, you keep the ticket and the cloakroom keeps a matching stub. Here the stub is a *fingerprint* of your ticket (SHA-256). Even if someone photographs every stub, they can't print a working ticket. Lose your ticket? It's shown **once** and can't be shown again, so you make a new one and tear up the old stub (revoke).

**Step 1.** Create `gateway/src/keys/keys.service.ts`:

```typescript
// gateway/src/keys/keys.service.ts
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { toAuthUser, type AuthUser, type Role } from '../auth/auth.types.js';

const MAX_ACTIVE_KEYS_PER_USER = 10;

export type KeyAuthResult =
  | { kind: 'ok'; user: AuthUser; keyId: string }
  | { kind: 'revoked'; user: AuthUser; keyId: string }
  | { kind: 'invalid' };

@Injectable()
export class KeysService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async create(userId: string, name: string, createdBy: string) {
    const owner = await this.db.one<{ active: number }>(
      `SELECT (SELECT count(*)::int FROM api_keys WHERE user_id = u.id AND revoked_at IS NULL) AS active
         FROM users u WHERE u.id = $1 AND u.status = 'active'`,
      [userId],
    );
    if (!owner) throw new NotFoundException('Active user not found');
    if (owner.active >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new BadRequestException(`A user can have at most ${MAX_ACTIVE_KEYS_PER_USER} active keys`);
    }

    const key = randomToken('mcpk_');
    const prefix = key.slice(0, 12);
    const row = await this.db.one<{ id: string; created_at: Date }>(
      `INSERT INTO api_keys (user_id, name, prefix, key_hash, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [userId, name, prefix, sha256(key), createdBy],
    );
    // `key` is returned exactly once. Only its hash is stored.
    return { id: row!.id, name, prefix, key, createdAt: row!.created_at };
  }

  listForUser(userId: string) {
    return this.db.query(
      `SELECT id, name, prefix, created_at AS "createdAt", last_used_at AS "lastUsedAt",
              revoked_at AS "revokedAt"
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
  }

  /** Members can revoke their own keys; admins can revoke anyone's. */
  async revoke(actor: AuthUser, keyId: string): Promise<void> {
    const row = await this.db.one(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND (user_id = $2 OR $3)
        RETURNING id`,
      [keyId, actor.id, actor.role === 'admin'],
    );
    if (!row) throw new NotFoundException('Key not found or already revoked');
  }

  /** One indexed lookup per MCP request, so revocation takes effect on the very next call. */
  async authenticate(raw: string | null): Promise<KeyAuthResult> {
    if (!raw || !raw.startsWith('mcpk_')) return { kind: 'invalid' };
    const row = await this.db.one<{
      key_id: string;
      revoked_at: Date | null;
      id: string;
      email: string;
      name: string;
      role: Role;
      status: string;
    }>(
      `SELECT k.id AS key_id, k.revoked_at, u.id, u.email, u.name, u.role, u.status
         FROM api_keys k JOIN users u ON u.id = k.user_id
        WHERE k.key_hash = $1`,
      [sha256(raw)],
    );
    if (!row) return { kind: 'invalid' };

    const user = toAuthUser(row);
    if (row.revoked_at || row.status !== 'active') return { kind: 'revoked', user, keyId: row.key_id };

    void this.db
      .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id])
      .catch(() => undefined);
    return { kind: 'ok', user, keyId: row.key_id };
  }
}
```

**Step 2.** Create `gateway/src/keys/keys.controller.ts`:

```typescript
// gateway/src/keys/keys.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/validation.js';
import { SessionGuard } from '../auth/auth.guards.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { KeysService } from './keys.service.js';

export const CreateKeySchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
});

@Controller('api/keys')
@UseGuards(SessionGuard)
export class KeysController {
  constructor(@Inject(KeysService) private readonly keys: KeysService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.keys.listForUser(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { name } = parseBody(CreateKeySchema, body);
    return this.keys.create(user.id, name, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.keys.revoke(user, id);
  }
}
```

**Step 3.** Add admin key management to `MembersController`. Update the imports and constructor, then add two routes:

```typescript
// gateway/src/auth/members.controller.ts — additions for Phase 9
import { KeysService } from '../keys/keys.service.js';
import { CreateKeySchema } from '../keys/keys.controller.js';

// constructor becomes:
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(KeysService) private readonly keys: KeysService,
  ) {}

// new routes inside the class:
  @Get(':id/keys')
  memberKeys(@Param('id', ParseUUIDPipe) id: string) {
    return this.keys.listForUser(id);
  }

  @Post(':id/keys')
  issueKey(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { name } = parseBody(CreateKeySchema, body);
    return this.keys.create(id, name, actor.id);
  }
```

**Step 4.** Register in `app.module.ts`: add `KeysController` to `controllers` and `KeysService` to `providers` (with imports).

> ✅ **Validate**
> ```powershell
> PS> $keyB = Invoke-RestMethod -Method Post "$base/api/keys" -Headers $bH -ContentType "application/json" -Body (@{ name = "claude-code" } | ConvertTo-Json)
> PS> $keyB.key                      # mcpk_… shown ONCE, so copy it somewhere safe
> PS> Invoke-RestMethod "$base/api/keys" -Headers $bH      # prefix only, never the key
> PS> docker exec -it gateway-pg psql -U gateway -d gateway -c "select prefix, key_hash, revoked_at from api_keys;"
> ```
> The list shows `prefix` like `mcpk_AbC1234` and no full key. The DB holds a 64-hex-character hash. Save `$keyB.key`, because Phase 13 uses it.

> ⚠️ **Heads up**
> Don't revoke B's key yet. Revocation is the dramatic moment of your demo, so save it for the end.

> 🎤 **Interview angle — "How fast is revocation?"**
> "Immediate. There's no cache: every MCP request does one indexed lookup by `key_hash` and checks `revoked_at` and the user's status. If that ever showed up in a profile, I'd add a small TTL cache (say 5 seconds) and accept that revocation takes up to 5 seconds, a documented trade-off."

---

# PHASE 10
## Upstream registry: CRUD, encrypted credentials, SSRF guard, seeding

### Lesson 10.1 — Tool naming helpers

⏱ ~10 min — **Goal:** The namespacing rules from Part 1, as code with tests

Create `gateway/src/upstreams/tool-names.ts`:

```typescript
// gateway/src/upstreams/tool-names.ts
export const TOOL_SEPARATOR = '__';

/** Server slugs: 2–20 chars, lowercase letters/digits, starts with a letter. No "_" → unambiguous split. */
export const SLUG_PATTERN = /^[a-z][a-z0-9]{1,19}$/;

/** Upstream tool names we can expose: safe for MCP AND for LLM function-calling (≤ 64 chars total). */
const EXPOSABLE_TOOL = /^[A-Za-z0-9_-]{1,42}$/;

export function exposedToolName(slug: string, tool: string): string {
  return `${slug}${TOOL_SEPARATOR}${tool}`;
}

export function isExposableToolName(tool: string): boolean {
  return EXPOSABLE_TOOL.test(tool);
}

export function parseToolName(name: string): { slug: string; tool: string } | null {
  const index = name.indexOf(TOOL_SEPARATOR);
  if (index <= 0) return null;
  const slug = name.slice(0, index);
  const tool = name.slice(index + TOOL_SEPARATOR.length);
  if (!SLUG_PATTERN.test(slug) || tool.length === 0) return null;
  return { slug, tool };
}
```

Create `gateway/test/tool-names.test.ts`:

```typescript
// gateway/test/tool-names.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposedToolName, isExposableToolName, parseToolName } from '../src/upstreams/tool-names.js';

test('namespaced names round-trip', () => {
  assert.equal(exposedToolName('woo', 'list_orders'), 'woo__list_orders');
  assert.deepEqual(parseToolName('woo__list_orders'), { slug: 'woo', tool: 'list_orders' });
});

test('split happens at the FIRST separator', () => {
  assert.deepEqual(parseToolName('utils__weird__name'), { slug: 'utils', tool: 'weird__name' });
});

test('rejects malformed names', () => {
  for (const bad of ['list_orders', '__x', 'Woo__x', 'w__x', 'woo__', 'a-b__x']) {
    assert.equal(parseToolName(bad), null, bad);
  }
});

test('exposable tool names are LLM-safe', () => {
  assert.equal(isExposableToolName('get_order'), true);
  assert.equal(isExposableToolName('has.dot'), false);
  assert.equal(isExposableToolName('x'.repeat(43)), false);
});
```

> ✅ **Validate** — `npm test` → all passing.

---

### Lesson 10.2 — The SSRF guard

⏱ ~20 min — **Goal:** Admins can't point the gateway at internal or metadata addresses

Create `gateway/src/upstreams/ssrf.ts`:

```typescript
// gateway/src/upstreams/ssrf.ts
import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface SsrfPolicy {
  allowPrivateUpstreams: boolean;
  upstreamAllowHosts: string[];
}

const blocked = new BlockList();
const IPV4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
const IPV6_BLOCKS: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of IPV4_BLOCKS) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of IPV6_BLOCKS) blocked.addSubnet(net, prefix, 'ipv6');

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.svc', '.cluster.local'];

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

export async function assertSafeUpstreamUrl(raw: string, policy: SsrfPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Upstream URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http and https upstream URLs are allowed');
  }
  if (url.username || url.password) {
    throw new BadRequestException('Do not put credentials in the URL; use the credential field');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (policy.allowPrivateUpstreams || policy.upstreamAllowHosts.includes(host)) return url;

  const looksInternal =
    host === 'localhost' ||
    INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    (!host.includes('.') && isIP(host) === 0);
  if (looksInternal) {
    throw new BadRequestException(`"${host}" is an internal hostname and is not on the upstream allowlist`);
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      throw new BadRequestException(`Could not resolve "${host}"`);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BadRequestException(`"${host}" resolves to a private or internal address, which is not allowed`);
  }
  return url;
}
```

Create `gateway/test/ssrf.test.ts`:

```typescript
// gateway/test/ssrf.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUpstreamUrl, isBlockedAddress } from '../src/upstreams/ssrf.js';

const strict = { allowPrivateUpstreams: false, upstreamAllowHosts: ['woo-mcp.urumi-platform.svc.cluster.local'] };

test('blocks private, loopback and metadata addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});

test('rejects internal URLs unless allowlisted', async () => {
  await assert.rejects(assertSafeUpstreamUrl('http://169.254.169.254/latest/meta-data', strict));
  await assert.rejects(assertSafeUpstreamUrl('http://localhost:3000/mcp', strict));
  await assert.rejects(assertSafeUpstreamUrl('http://gateway-postgres.urumi-platform.svc.cluster.local:5432', strict));
  await assert.rejects(assertSafeUpstreamUrl('ftp://example.com/mcp', strict));
  await assert.rejects(assertSafeUpstreamUrl('http://user:pw@example.com/mcp', strict));
  const ok = await assertSafeUpstreamUrl('http://woo-mcp.urumi-platform.svc.cluster.local:3001/mcp', strict);
  assert.equal(ok.hostname, 'woo-mcp.urumi-platform.svc.cluster.local');
});
```

> ✅ **Validate** — `npm test` → all passing (no network needed: every rejected case fails before DNS).

> 💡 **What just happened?**
> `node:net`'s `BlockList` does the CIDR math for you, so there are no hand-rolled bit operations to get wrong. Notice `::ffff:127.0.0.1`: an IPv4-mapped IPv6 address is a classic SSRF bypass, and you block it.

---

### Lesson 10.3 — `UpstreamsService`: CRUD + encrypted credentials + seeding

⏱ ~30 min — **Goal:** Upstreams persisted, credentials never stored or returned in plaintext

Create `gateway/src/upstreams/upstreams.service.ts`:

```typescript
// gateway/src/upstreams/upstreams.service.ts
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONFIG, type AppConfig, type AuthType, type SeedUpstream } from '../config.js';
import { DbService } from '../db/db.service.js';
import { decryptSecret, encryptSecret } from '../common/crypto.js';
import { assertSafeUpstreamUrl } from './ssrf.js';
import { SLUG_PATTERN } from './tool-names.js';

export interface UpstreamRecord {
  id: string;
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string | null;
  authSecretEnc: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUpstreamInput {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  headerName?: string | null;
  credential?: string | null;
}

export interface UpdateUpstreamInput {
  name?: string;
  url?: string;
  authType?: AuthType;
  headerName?: string | null;
  /** undefined = keep, null or "" = clear, string = replace */
  credential?: string | null;
  enabled?: boolean;
}

const COLUMNS = `id, slug, name, url, auth_type AS "authType", auth_header_name AS "authHeaderName",
  auth_secret_enc AS "authSecretEnc", enabled, created_at AS "createdAt", updated_at AS "updatedAt"`;

const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set([
  'host', 'content-length', 'content-type', 'accept', 'connection', 'transfer-encoding',
  'cookie', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id',
]);

@Injectable()
export class UpstreamsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  listAll(): Promise<UpstreamRecord[]> {
    return this.db.query<UpstreamRecord>(`SELECT ${COLUMNS} FROM upstreams ORDER BY created_at`);
  }

  listEnabled(): Promise<UpstreamRecord[]> {
    return this.db.query<UpstreamRecord>(`SELECT ${COLUMNS} FROM upstreams WHERE enabled ORDER BY created_at`);
  }

  async findById(id: string): Promise<UpstreamRecord> {
    const row = await this.db.one<UpstreamRecord>(`SELECT ${COLUMNS} FROM upstreams WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException('Upstream not found');
    return row;
  }

  findBySlug(slug: string): Promise<UpstreamRecord | null> {
    return this.db.one<UpstreamRecord>(`SELECT ${COLUMNS} FROM upstreams WHERE slug = $1`, [slug]);
  }

  async create(input: CreateUpstreamInput, options: { trusted?: boolean } = {}): Promise<UpstreamRecord> {
    if (!SLUG_PATTERN.test(input.slug)) throw new BadRequestException('Invalid slug');
    if (!options.trusted) await assertSafeUpstreamUrl(input.url, this.config);
    const auth = this.resolveAuth(input.authType, input.headerName ?? null, null, input.credential);

    const row = await this.db
      .one<UpstreamRecord>(
        `INSERT INTO upstreams (slug, name, url, auth_type, auth_header_name, auth_secret_enc)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [input.slug, input.name, input.url, auth.authType, auth.headerName, auth.secretEnc],
      )
      .catch((err: { code?: string }) => {
        if (err.code === '23505') throw new ConflictException(`Slug "${input.slug}" is already in use`);
        throw err;
      });
    return row!;
  }

  async update(id: string, patch: UpdateUpstreamInput): Promise<UpstreamRecord> {
    const current = await this.findById(id);
    const url = patch.url ?? current.url;
    if (patch.url !== undefined && patch.url !== current.url) {
      await assertSafeUpstreamUrl(url, this.config);
    }
    const auth = this.resolveAuth(
      patch.authType ?? current.authType,
      patch.headerName !== undefined ? patch.headerName : current.authHeaderName,
      current.authSecretEnc,
      patch.credential,
    );

    const row = await this.db.one<UpstreamRecord>(
      `UPDATE upstreams
          SET name = $2, url = $3, auth_type = $4, auth_header_name = $5, auth_secret_enc = $6,
              enabled = $7, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, patch.name ?? current.name, url, auth.authType, auth.headerName, auth.secretEnc, patch.enabled ?? current.enabled],
    );
    return row!;
  }

  async remove(id: string): Promise<void> {
    const row = await this.db.one('DELETE FROM upstreams WHERE id = $1 RETURNING id', [id]);
    if (!row) throw new NotFoundException('Upstream not found');
  }

  /** Decrypts the credential in memory, only right before an upstream request. */
  authHeadersFor(upstream: UpstreamRecord): Record<string, string> {
    if (upstream.authType === 'none' || !upstream.authSecretEnc) return {};
    const secret = decryptSecret(upstream.authSecretEnc, this.config.encryptionKey);
    if (upstream.authType === 'bearer') return { Authorization: `Bearer ${secret}` };
    return { [upstream.authHeaderName!]: secret };
  }

  /** The only shape that ever leaves the server: no secret, just "is one set?". */
  toPublic(upstream: UpstreamRecord) {
    return {
      id: upstream.id,
      slug: upstream.slug,
      name: upstream.name,
      url: upstream.url,
      authType: upstream.authType,
      authHeaderName: upstream.authHeaderName,
      hasCredential: upstream.authSecretEnc !== null,
      enabled: upstream.enabled,
      createdAt: upstream.createdAt,
      updatedAt: upstream.updatedAt,
    };
  }

  /** Seeds an upstream once ever. Deleting it later is respected across restarts. */
  async seed(seed: SeedUpstream): Promise<void> {
    const key = `seed-upstream:${seed.slug}`;
    if (await this.db.one('SELECT key FROM bootstrap_state WHERE key = $1', [key])) return;

    const credential = seed.secretEnv ? process.env[seed.secretEnv]?.trim() : undefined;
    if (seed.authType !== 'none' && !credential) {
      throw new Error(`Seed upstream "${seed.slug}" needs env var ${seed.secretEnv ?? '(secretEnv not set)'}`);
    }
    try {
      await this.create(
        { slug: seed.slug, name: seed.name, url: seed.url, authType: seed.authType, headerName: seed.headerName ?? null, credential },
        { trusted: true },
      );
      console.log(`[bootstrap] registered upstream "${seed.slug}"`);
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err; // another replica won the race
    }
    await this.db.query('INSERT INTO bootstrap_state (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  }

  private resolveAuth(
    authType: AuthType,
    headerName: string | null,
    existingSecretEnc: string | null,
    credential: string | null | undefined,
  ): { authType: AuthType; headerName: string | null; secretEnc: string | null } {
    if (authType === 'none') return { authType, headerName: null, secretEnc: null };

    let secretEnc = existingSecretEnc;
    if (credential === null || credential === '') secretEnc = null;
    else if (credential !== undefined) secretEnc = encryptSecret(credential, this.config.encryptionKey);
    if (!secretEnc) throw new BadRequestException(`A credential is required for auth type "${authType}"`);

    if (authType === 'header') {
      if (!headerName || !HEADER_NAME.test(headerName) || FORBIDDEN_HEADERS.has(headerName.toLowerCase())) {
        throw new BadRequestException('A valid custom header name is required (letters, digits, "-")');
      }
      return { authType, headerName, secretEnc };
    }
    return { authType, headerName: null, secretEnc };
  }
}
```

**Step 2.** Seed upstreams on boot. In `bootstrap.service.ts`, inject `UpstreamsService` and call it after `seedAdmin()`:

```typescript
// gateway/src/bootstrap.service.ts — Phase 10 changes
import { UpstreamsService } from './upstreams/upstreams.service.js';

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
  ) {}

  async run(): Promise<void> {
    await this.db.migrate();
    await this.seedAdmin();
    for (const seed of this.config.seedUpstreams) await this.upstreams.seed(seed);
    console.log('[bootstrap] done');
  }
```

**Step 3.** Add `UpstreamsService` to `providers` in `app.module.ts`.

> ✅ **Validate**
> Restart. Logs show `registered upstream "woo"` and `registered upstream "utils"`. Then:
> ```powershell
> PS> docker exec -it gateway-pg psql -U gateway -d gateway -c "select slug, auth_type, auth_header_name, left(auth_secret_enc, 30) as enc from upstreams;"
> ```
> `enc` starts with `v1:` followed by base64. **Your WooCommerce token isn't visible anywhere in the database.** Restart again: no duplicate rows (seeding happens once).

> 🎤 **Interview angle — "What if someone steals your Postgres backup?"**
> "They get scrypt password hashes, SHA-256 key and session hashes (useless without the originals), and AES-GCM-encrypted upstream credentials. The encryption key isn't in the database. It lives in a Kubernetes Secret injected as an env var. They'd need both."

---

# PHASE 11
## MCP client pool + health snapshots

### Lesson 11.1 — Readable upstream errors

⏱ ~10 min — **Goal:** Turn `TypeError: fetch failed` into "Upstream 'Utilities' is unreachable (ECONNREFUSED)"

Create `gateway/src/upstreams/upstream-errors.ts`:

```typescript
// gateway/src/upstreams/upstream-errors.ts
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

function flatten(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
    const causeMessage = cause instanceof Error ? `: ${cause.message}` : '';
    return { message: `${err.message}${causeMessage}`, code: typeof code === 'string' ? code : undefined };
  }
  return { message: String(err) };
}

export function describeUpstreamError(upstreamName: string, err: unknown, timeoutMs: number): string {
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return `Upstream "${upstreamName}" did not respond within ${Math.round(timeoutMs / 1000)}s`;
  }
  const { message, code } = flatten(err);
  if (code && /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|UND_ERR_\w+)$/.test(code)) {
    return `Upstream "${upstreamName}" is unreachable (${code})`;
  }
  if (/fetch failed|socket hang up|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return `Upstream "${upstreamName}" is unreachable (connection failed)`;
  }
  if (/\b401\b|unauthori[sz]ed/i.test(message)) {
    return `Upstream "${upstreamName}" rejected the gateway's credential (401)`;
  }
  if (/redirect/i.test(message)) {
    return `Upstream "${upstreamName}" tried to redirect, which the gateway refuses`;
  }
  return `Upstream "${upstreamName}" failed: ${message.slice(0, 200)}`;
}
```

---

### Lesson 11.2 — `UpstreamPool`: cached connections, timeouts, drop-on-error

⏱ ~25 min — **Goal:** One MCP client per upstream, rebuilt automatically when config changes or the connection breaks

> 🧠 **Intuition — the taxi rank**
> Keep one taxi (connection) waiting per destination. If the taxi breaks down, send it away and call a fresh one next time. If the destination's address changes (admin edits the URL), the old taxi is useless, so swap it.

Create `gateway/src/upstreams/upstream-pool.ts`:

```typescript
// gateway/src/upstreams/upstream-pool.ts
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CONFIG, type AppConfig } from '../config.js';
import { assertSafeUpstreamUrl } from './ssrf.js';
import { UpstreamsService, type UpstreamRecord } from './upstreams.service.js';

interface PoolEntry {
  version: string;
  client: Promise<Client>;
}

const MAX_TOOLS_PER_UPSTREAM = 500;

@Injectable()
export class UpstreamPool implements OnModuleDestroy {
  private readonly entries = new Map<string, PoolEntry>();

  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async listTools(upstream: UpstreamRecord): Promise<Tool[]> {
    try {
      const client = await this.get(upstream);
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, {
          timeout: this.config.listTimeoutMs,
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor && tools.length < MAX_TOOLS_PER_UPSTREAM);
      return tools.slice(0, MAX_TOOLS_PER_UPSTREAM);
    } catch (err) {
      this.drop(upstream.id);
      throw err;
    }
  }

  async callTool(upstream: UpstreamRecord, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const client = await this.get(upstream);
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: this.config.callTimeoutMs,
      });
      return result as CallToolResult;
    } catch (err) {
      this.drop(upstream.id);
      throw err;
    }
  }

  drop(upstreamId: string): void {
    const entry = this.entries.get(upstreamId);
    if (!entry) return;
    this.entries.delete(upstreamId);
    entry.client.then((client) => client.close()).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  private get(upstream: UpstreamRecord): Promise<Client> {
    // Any edit bumps updated_at → new version → fresh connection with the new URL/credential.
    const version = `${upstream.id}:${upstream.updatedAt.getTime()}`;
    const existing = this.entries.get(upstream.id);
    if (existing && existing.version === version) return existing.client;
    if (existing) this.drop(upstream.id);

    const client = this.connect(upstream);
    this.entries.set(upstream.id, { version, client });
    client.catch(() => {
      if (this.entries.get(upstream.id)?.client === client) this.entries.delete(upstream.id);
    });
    return client;
  }

  private async connect(upstream: UpstreamRecord): Promise<Client> {
    // Re-check at connect time too (DNS may have changed since registration).
    await assertSafeUpstreamUrl(upstream.url, this.config);
    const transport = new StreamableHTTPClientTransport(new URL(upstream.url), {
      requestInit: {
        headers: this.upstreams.authHeadersFor(upstream),
        redirect: 'error',
      },
    });
    const client = new Client({ name: 'urumi-mcp-gateway', version: '1.0.0' });
    await client.connect(transport, { timeout: this.config.listTimeoutMs });
    return client;
  }
}
```

> 💡 **What just happened?**
> - `connect()` performs the MCP `initialize` handshake from Part 1, with a timeout.
> - The map stores the **promise** of a client, so 20 concurrent calls during a reconnect share **one** connection attempt instead of opening 20.
> - `redirect: 'error'`: an upstream can't bounce the gateway (and its credential header) to another host.
> - Credentials are decrypted inside `authHeadersFor()` at connect time and live only in the transport's memory.

---

### Lesson 11.3 — `UpstreamHealthService`: Connected / Unreachable / Disabled

⏱ ~25 min — **Goal:** Per-upstream status + tool snapshots, refreshed in the background and on demand

Create `gateway/src/upstreams/upstream-health.service.ts`:

```typescript
// gateway/src/upstreams/upstream-health.service.ts
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CONFIG, type AppConfig } from '../config.js';
import { UpstreamPool } from './upstream-pool.js';
import { UpstreamsService, type UpstreamRecord } from './upstreams.service.js';
import { describeUpstreamError } from './upstream-errors.js';
import { exposedToolName, isExposableToolName } from './tool-names.js';

export type UpstreamStatus = 'connected' | 'unreachable' | 'disabled' | 'checking';

export interface UpstreamSnapshot {
  upstream: UpstreamRecord;
  status: UpstreamStatus;
  tools: Tool[];
  skippedTools: string[];
  lastError: string | null;
  checkedAt: number;
  latencyMs: number | null;
}

const SNAPSHOT_TTL_MS = 10_000;

@Injectable()
export class UpstreamHealthService implements OnModuleDestroy {
  private readonly snapshots = new Map<string, UpstreamSnapshot>();
  private readonly inflight = new Map<string, Promise<UpstreamSnapshot>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamPool) private readonly pool: UpstreamPool,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.config.healthIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refreshAll(): Promise<void> {
    try {
      const all = await this.upstreams.listAll();
      const ids = new Set(all.map((u) => u.id));
      for (const id of this.snapshots.keys()) if (!ids.has(id)) this.snapshots.delete(id);
      await Promise.all(all.map((u) => this.refresh(u)));
    } catch (err) {
      console.error('[health] refreshAll failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Returns a cached snapshot if it's fresh, otherwise refreshes. NEVER rejects. */
  getFresh(upstream: UpstreamRecord): Promise<UpstreamSnapshot> {
    const snap = this.snapshots.get(upstream.id);
    const sameConfig = snap?.upstream.updatedAt.getTime() === upstream.updatedAt.getTime();
    if (snap && sameConfig && Date.now() - snap.checkedAt < SNAPSHOT_TTL_MS) return Promise.resolve(snap);
    return this.refresh(upstream);
  }

  /** Forces a check. Concurrent callers share one in-flight check per upstream. NEVER rejects. */
  refresh(upstream: UpstreamRecord): Promise<UpstreamSnapshot> {
    const running = this.inflight.get(upstream.id);
    if (running) return running;
    const task = this.check(upstream).finally(() => this.inflight.delete(upstream.id));
    this.inflight.set(upstream.id, task);
    return task;
  }

  forget(upstreamId: string): void {
    this.snapshots.delete(upstreamId);
    this.pool.drop(upstreamId);
  }

  /** What the dashboard shows for one server. */
  view(upstream: UpstreamRecord) {
    const snap = this.snapshots.get(upstream.id);
    const status: UpstreamStatus = !upstream.enabled ? 'disabled' : (snap?.status ?? 'checking');
    return {
      status,
      lastError: status === 'unreachable' ? (snap?.lastError ?? null) : null,
      checkedAt: snap ? new Date(snap.checkedAt).toISOString() : null,
      latencyMs: snap?.latencyMs ?? null,
      skippedTools: snap?.skippedTools ?? [],
      tools:
        status === 'connected'
          ? (snap?.tools ?? []).map((tool) => ({
              name: exposedToolName(upstream.slug, tool.name),
              originalName: tool.name,
              description: tool.description ?? '',
              readOnly: tool.annotations?.readOnlyHint ?? null,
            }))
          : [],
    };
  }

  private async check(upstream: UpstreamRecord): Promise<UpstreamSnapshot> {
    const started = Date.now();
    let snapshot: UpstreamSnapshot;
    if (!upstream.enabled) {
      this.pool.drop(upstream.id);
      snapshot = { upstream, status: 'disabled', tools: [], skippedTools: [], lastError: null, checkedAt: Date.now(), latencyMs: null };
    } else {
      try {
        const all = await this.pool.listTools(upstream);
        const tools = all.filter((tool) => isExposableToolName(tool.name));
        const skippedTools = all.filter((tool) => !isExposableToolName(tool.name)).map((tool) => tool.name);
        snapshot = { upstream, status: 'connected', tools, skippedTools, lastError: null, checkedAt: Date.now(), latencyMs: Date.now() - started };
      } catch (err) {
        snapshot = {
          upstream,
          status: 'unreachable',
          tools: [],
          skippedTools: [],
          lastError: describeUpstreamError(upstream.name, err, this.config.listTimeoutMs),
          checkedAt: Date.now(),
          latencyMs: null,
        };
      }
    }
    this.snapshots.set(upstream.id, snapshot);
    return snapshot;
  }
}
```

> 🎤 **Interview angle — "Why a 10-second snapshot cache?"**
> "Without it, every `tools/list` from every client fans out to every upstream. With 10 clients and 3 upstreams that's 30 upstream requests per refresh. The cache bounds that. Combined with the in-flight dedupe, a burst of 50 list calls costs at most one check per upstream. The trade-off: a server that dies is still listed for up to 10 seconds, but calls to it fail fast with a clear error, and the health loop marks it unreachable within one interval."

---

### Lesson 11.4 — `UpstreamsController`: the admin API for servers

⏱ ~20 min — **Goal:** List with status + tools for everyone, and add/edit/disable/remove/refresh for admins

Create `gateway/src/upstreams/upstreams.controller.ts`:

```typescript
// gateway/src/upstreams/upstreams.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/validation.js';
import { AdminGuard, SessionGuard } from '../auth/auth.guards.js';
import { UpstreamsService, type UpstreamRecord } from './upstreams.service.js';
import { UpstreamHealthService } from './upstream-health.service.js';
import { UpstreamPool } from './upstream-pool.js';
import { SLUG_PATTERN } from './tool-names.js';

const CreateUpstreamSchema = z.strictObject({
  slug: z.string().regex(SLUG_PATTERN, 'slug: 2-20 lowercase letters/digits, starting with a letter'),
  name: z.string().trim().min(1).max(80),
  url: z.url().max(500),
  authType: z.enum(['none', 'bearer', 'header']).default('none'),
  headerName: z.string().max(64).nullable().optional(),
  credential: z.string().min(1).max(4096).nullable().optional(),
});

const UpdateUpstreamSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.url().max(500).optional(),
  authType: z.enum(['none', 'bearer', 'header']).optional(),
  headerName: z.string().max(64).nullable().optional(),
  credential: z.string().max(4096).nullable().optional(),
  enabled: z.boolean().optional(),
});

@Controller('api/upstreams')
@UseGuards(SessionGuard)
export class UpstreamsController {
  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamHealthService) private readonly health: UpstreamHealthService,
    @Inject(UpstreamPool) private readonly pool: UpstreamPool,
  ) {}

  @Get()
  async list() {
    const all = await this.upstreams.listAll();
    return all.map((u) => this.present(u));
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: unknown) {
    const created = await this.upstreams.create(parseBody(CreateUpstreamSchema, body));
    await this.health.refresh(created);
    return this.present(created);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const updated = await this.upstreams.update(id, parseBody(UpdateUpstreamSchema, body));
    this.pool.drop(id);
    await this.health.refresh(updated);
    return this.present(updated);
  }

  @Post(':id/refresh')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async refresh(@Param('id', ParseUUIDPipe) id: string) {
    const upstream = await this.upstreams.findById(id);
    this.pool.drop(id);
    await this.health.refresh(upstream);
    return this.present(upstream);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.upstreams.remove(id);
    this.health.forget(id);
  }

  private present(upstream: UpstreamRecord) {
    return { ...this.upstreams.toPublic(upstream), ...this.health.view(upstream) };
  }
}
```

**Update `main.ts`** to start the background health loop after bootstrap:

```typescript
// gateway/src/main.ts — after `await app.get(BootstrapService).run();`
import { UpstreamHealthService } from './upstreams/upstream-health.service.js';
  // ...
  app.get(UpstreamHealthService).start();
```

**Update `app.module.ts`**: add `UpstreamsController` to controllers, and `UpstreamPool` and `UpstreamHealthService` to providers.

> ✅ **Validate**
> Start the woo adapter (`.\scripts\run-local-adapter.ps1` from the repo root) and restart the gateway. Then:
> ```powershell
> PS> Invoke-RestMethod "$base/api/upstreams" -Headers $adminH | ConvertTo-Json -Depth 6
> ```
> `woo` shows `status: connected` and 5 tools named `woo__list_products` … `woo__update_order_status`. `utils` shows `unreachable` with an `ECONNREFUSED` message, which is correct because you haven't built it yet. **That's failure isolation working already.** Note that `hasCredential: true` appears but no secret does.

> ⚠️ **Heads up**
> - `woo` unreachable with "rejected the gateway's credential (401)": `WOO_MCP_TOKEN` in `gateway/.env` doesn't match the adapter's token. Fix `.env`. **The seed already ran**, so either update the credential via `PATCH /api/upstreams/:id` with `{"credential":"…"}` or reset the dev DB (`docker rm -f gateway-pg` and re-run Lesson 5.2).
> - A Host/Origin rejection from the adapter: it's comparing `Host: 127.0.0.1:3001`. Make sure you used `127.0.0.1`, not `localhost`, in the seed URL, or match whatever your adapter allows.
> - Protocol version errors during `initialize`: update `@modelcontextprotocol/sdk` to the latest 1.x (`npm install @modelcontextprotocol/sdk@latest`) so both sides share a supported version.

---

# PHASE 12
## Tool router + audit log

### Lesson 12.1 — `AuditService`

⏱ ~15 min — **Goal:** One function every call path uses to write who/what/when/how long/outcome

Create `gateway/src/audit/audit.service.ts`:

```typescript
// gateway/src/audit/audit.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import type { AuthUser } from '../auth/auth.types.js';

export type AuditSource = 'mcp' | 'chat';
export type AuditOutcome = 'success' | 'error' | 'denied';

export interface AuditEntry {
  user: AuthUser;
  source: AuditSource;
  upstream: { id: string; name: string } | null;
  toolName: string;
  durationMs: number;
  outcome: AuditOutcome;
  detail?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Never throws: an audit write failure is logged loudly but must not crash the request. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_log (user_id, user_email, source, upstream_id, upstream_name, tool_name, duration_ms, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.user.id,
          entry.user.email,
          entry.source,
          entry.upstream?.id ?? null,
          entry.upstream?.name ?? null,
          entry.toolName,
          Math.max(0, Math.round(entry.durationMs)),
          entry.outcome,
          entry.detail ? entry.detail.slice(0, 500) : null,
        ],
      );
    } catch (err) {
      console.error('[audit] FAILED to write audit row:', err instanceof Error ? err.message : err, entry.toolName);
    }
  }

  list(options: { limit: number; userId?: string }) {
    const limit = Math.min(Math.max(options.limit, 1), 500);
    return this.db.query(
      `SELECT id, at, user_id AS "userId", user_email AS "userEmail", source,
              upstream_name AS "upstreamName", tool_name AS "toolName",
              duration_ms AS "durationMs", outcome, detail
         FROM audit_log
        WHERE ($1::uuid IS NULL OR user_id = $1::uuid)
        ORDER BY at DESC
        LIMIT $2`,
      [options.userId ?? null, limit],
    );
  }

  stats() {
    return this.db.query(
      `SELECT COALESCE(upstream_name, '(unrouted)') AS server,
              count(*)::int AS calls,
              count(*) FILTER (WHERE outcome = 'error')::int AS errors,
              count(*) FILTER (WHERE outcome = 'denied')::int AS denied,
              round(avg(duration_ms))::int AS "avgMs",
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int AS "p95Ms"
         FROM audit_log
        WHERE at > now() - interval '24 hours'
        GROUP BY 1
        ORDER BY calls DESC`,
    );
  }
}
```

> 🎤 **Interview angle — "If the audit insert fails, why do you still return the tool result?"**
> "By then the upstream call has already happened, so failing the response wouldn't undo it. It would only hide the result from the user. I log the failure loudly. A stricter design writes a 'pending' row *before* the call and fails closed if that write fails. That's what I'd do for regulated environments, at the cost of an extra write per call."

---

### Lesson 12.2 — `ToolRouter`: the heart of the gateway

⏱ ~30 min — **Goal:** `listTools(user)` and `callTool(user, name, args, source)`, used by BOTH `/mcp` and the chat agent

Create `gateway/src/router/tool-router.service.ts`:

```typescript
// gateway/src/router/tool-router.service.ts
import { Inject, Injectable } from '@nestjs/common';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CONFIG, type AppConfig } from '../config.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService, type AuditSource } from '../audit/audit.service.js';
import { UpstreamsService } from '../upstreams/upstreams.service.js';
import { UpstreamHealthService } from '../upstreams/upstream-health.service.js';
import { UpstreamPool } from '../upstreams/upstream-pool.js';
import { describeUpstreamError } from '../upstreams/upstream-errors.js';
import { exposedToolName, parseToolName } from '../upstreams/tool-names.js';

export interface GatewayTool {
  name: string;
  originalName: string;
  upstreamSlug: string;
  upstreamName: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  annotations?: Tool['annotations'];
}

const MAX_DESCRIPTION = 1024;

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Flattens a tool result into text (for the LLM and for audit details). */
export function resultText(result: CallToolResult): string {
  return (result.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : `[${block.type} content]`))
    .join('\n');
}

@Injectable()
export class ToolRouter {
  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamHealthService) private readonly health: UpstreamHealthService,
    @Inject(UpstreamPool) private readonly pool: UpstreamPool,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Aggregates tools from every ENABLED upstream that is currently reachable.
   * `user` is unused today; it's the hook for per-role tool permissions.
   */
  async listTools(_user: AuthUser): Promise<GatewayTool[]> {
    const enabled = await this.upstreams.listEnabled();
    // getFresh() never rejects and has its own timeout, so one dead upstream can't fail the list.
    const snapshots = await Promise.all(enabled.map((upstream) => this.health.getFresh(upstream)));
    return snapshots.flatMap((snap) =>
      snap.status !== 'connected'
        ? []
        : snap.tools.map((tool) => ({
            name: exposedToolName(snap.upstream.slug, tool.name),
            originalName: tool.name,
            upstreamSlug: snap.upstream.slug,
            upstreamName: snap.upstream.name,
            // Tag the source so the model (and humans) know which server wrote this text.
            description: `[${snap.upstream.name}] ${(tool.description ?? '').slice(0, MAX_DESCRIPTION)}`,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          })),
    );
  }

  async callTool(
    user: AuthUser,
    exposedName: string,
    args: Record<string, unknown>,
    source: AuditSource,
  ): Promise<CallToolResult> {
    const started = Date.now();
    const parsed = parseToolName(exposedName);
    const upstream = parsed ? await this.upstreams.findBySlug(parsed.slug) : null;

    if (!parsed || !upstream || !upstream.enabled) {
      const message = !upstream
        ? `Unknown tool "${exposedName}". Tool names look like <server>__<tool>; call tools/list to see what's available.`
        : `Server "${upstream.name}" is disabled by an administrator`;
      await this.audit.record({
        user, source, toolName: exposedName, durationMs: Date.now() - started, outcome: 'denied',
        upstream: upstream ? { id: upstream.id, name: upstream.name } : null, detail: message,
      });
      return errorResult(message);
    }

    const ref = { id: upstream.id, name: upstream.name };
    try {
      const result = await this.pool.callTool(upstream, parsed.tool, args);
      await this.audit.record({
        user, source, upstream: ref, toolName: parsed.tool, durationMs: Date.now() - started,
        outcome: result.isError ? 'error' : 'success',
        detail: result.isError ? resultText(result).slice(0, 300) : null,
      });
      return result;
    } catch (err) {
      const message = describeUpstreamError(upstream.name, err, this.config.callTimeoutMs);
      if (message.includes('unreachable')) void this.health.refresh(upstream); // update status quickly
      await this.audit.record({
        user, source, upstream: ref, toolName: parsed.tool, durationMs: Date.now() - started,
        outcome: 'error', detail: message,
      });
      return errorResult(message);
    }
  }
}
```

> 🧠 **Intuition — two front doors, one hallway**
> `/mcp` (Claude Code) and `/api/chat` (dashboard) are two front doors. Both lead into the **same hallway**: `ToolRouter`. That's why auth checks, routing, timeouts and audit can never drift apart between the two paths. That single sentence answers "how does the agent act as the logged-in user?"

> 💡 **What just happened?**
> - **Routing** = `parseToolName` + `findBySlug`. O(1) by unique index, no scanning.
> - **Disabled = denied**, even if a client has a stale tool list from before the admin disabled the server.
> - The audit `tool_name` stores the **original** tool name, and `upstream_name` stores the server, which is exactly the "which server and tool" columns the brief asks for.
> - Errors become `isError` results so the model can react (Part 1, Lesson 1.2).

---

### Lesson 12.3 — `AuditController`

⏱ ~10 min — **Goal:** Admins see everything, members see their own calls

Create `gateway/src/audit/audit.controller.ts`:

```typescript
// gateway/src/audit/audit.controller.ts
import { Controller, Get, Inject, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AdminGuard, SessionGuard } from '../auth/auth.guards.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from './audit.service.js';

@Controller('api/audit')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('userId', new ParseUUIDPipe({ optional: true })) userId?: string,
  ) {
    const parsedLimit = Number(limit ?? 100);
    return this.audit.list({
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
      // Members can only ever see their own rows, whatever they pass.
      userId: user.role === 'admin' ? userId : user.id,
    });
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  stats() {
    return this.audit.stats();
  }
}
```

**Register** `AuditService` and `ToolRouter` (providers) and `AuditController` (controllers) in `app.module.ts`.

> ✅ **Validate**
> Server boots. `Invoke-RestMethod "$base/api/audit" -Headers $adminH` returns `[]`, because no calls have been made yet. That changes in Phase 13.

---

# PHASE 13
## The `/mcp` endpoint + two more upstreams

### Lesson 13.1 — `McpController`: one stateless MCP server per request

⏱ ~30 min — **Goal:** External clients connect with one URL + one key and see every enabled server's tools

> 🧠 **Intuition — the pop-up receptionist**
> For every visitor, a fresh receptionist appears, checks the visitor's card, serves exactly that one request with the visitor's identity in mind, then disappears. No memory, so any copy of the building (replica) can serve any visitor.

Create `gateway/src/mcp/mcp.controller.ts`:

```typescript
// gateway/src/mcp/mcp.controller.ts
import { Controller, Delete, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { KeysService } from '../keys/keys.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ToolRouter } from '../router/tool-router.service.js';
import { bearerToken, type AuthUser } from '../auth/auth.types.js';

function jsonRpcError(res: Response, status: number, message: string, id: unknown = null): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id });
}

/** If the body is a tools/call, return the tool name (for auditing denied calls). */
function toolCallName(body: unknown): string | null {
  const message = body as { method?: unknown; params?: { name?: unknown } } | null;
  return message?.method === 'tools/call' && typeof message.params?.name === 'string' ? message.params.name : null;
}

@Controller('mcp')
export class McpController {
  constructor(
    @Inject(KeysService) private readonly keys: KeysService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ToolRouter) private readonly router: ToolRouter,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = await this.keys.authenticate(bearerToken(req));
    if (auth.kind !== 'ok') {
      const body = req.body as { id?: unknown } | undefined;
      const toolName = toolCallName(req.body);
      if (auth.kind === 'revoked' && toolName) {
        // We know WHO tried (the key's owner), so the rejection is attributed in the audit log.
        await this.audit.record({
          user: auth.user, source: 'mcp', upstream: null, toolName, durationMs: 0,
          outcome: 'denied', detail: 'API key revoked or user disabled',
        });
      }
      jsonRpcError(res, 401, auth.kind === 'revoked' ? 'API key has been revoked' : 'Missing or invalid API key', body?.id ?? null);
      return;
    }

    const server = this.buildServer(auth.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no Mcp-Session-Id, no sticky sessions
      enableJsonResponse: true, // plain JSON responses instead of SSE
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err instanceof Error ? err.message : err);
      if (!res.headersSent) jsonRpcError(res, 500, 'Internal gateway error');
    }
  }

  @Get()
  get(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    jsonRpcError(res, 405, 'Method not allowed: this gateway is stateless; use POST');
  }

  @Delete()
  remove(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    jsonRpcError(res, 405, 'Method not allowed: this gateway is stateless; there is no session to delete');
  }

  private buildServer(user: AuthUser): Server {
    const server = new Server(
      { name: 'urumi-mcp-gateway', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'Tools are namespaced as <server>__<tool>. Every call is made as your user and recorded in the audit log.',
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.router.listTools(user);
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        })),
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.router.callTool(user, request.params.name, request.params.arguments ?? {}, 'mcp');
    });

    return server;
  }
}
```

**Register** `McpController` in `app.module.ts`.

> ⚠️ **Heads up — SDK drift**
> If your installed 1.x version marks `Server` as deprecated, that's fine: it still works, and it's the correct primitive for a proxy. If `setRequestHandler(CallToolRequestSchema, …)` complains about the return type, add `as CallToolResult` (import the type from `types.js`).

> ✅ **Validate — raw JSON-RPC with user B's key**
> ```powershell
> PS> $mcpH = @{ Authorization = "Bearer $($keyB.key)"; Accept = "application/json, text/event-stream" }
> PS> $list = Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
> PS> $list.result.tools.name
> PS> $call = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"woo__list_products","arguments":{"per_page":2}}}'
> PS> (Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body $call).result.content[0].text
> PS> Invoke-RestMethod "$base/api/audit" -Headers $adminH | Format-Table at, userEmail, upstreamName, toolName, durationMs, outcome
> ```
> You see the five `woo__…` tools, real products, and an audit row: `userb@urumi.local | WooCommerce Store | list_products | 180 | success`.
>
> Also try **no key** (401), **a garbage key** (401), and `GET /mcp` (405).

> 💡 **What just happened?**
> The gateway is now an MCP **server** (toward you) and an MCP **client** (toward woo) at the same time, with user B's identity carried from the key all the way into the audit log. That's the core of the assignment.

---

### Lesson 13.2 — Upstream #2: your own `utils` MCP server

⏱ ~30 min — **Goal:** A tiny in-cluster MCP server that uses a **custom header** credential and has tools for cross-server, collision and timeout demos

> 💡 **Why this server?**
> It makes the definition of done demonstrable on demand:
> - `convert_currency` → the cross-server prompt: "What came in today, and what's the total in EUR?" (woo + utils)
> - `echo` → a deliberate name collision with the `everything` server's `echo`
> - `sleep` → a controllable **slow upstream** to show timeouts
> - `X-Api-Key` header auth → shows the "header" credential type (woo uses "bearer")

**Step 1.** Create the folder and install the SDK:

```powershell
PS> cd ..   # repo root
PS> mkdir mcp-servers\utils
PS> cd mcp-servers\utils
PS> npm init -y
PS> npm install @modelcontextprotocol/sdk
```

**Step 2.** Replace `mcp-servers/utils/package.json`'s non-dependency fields with:

```json
{
  "name": "urumi-utils-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "node server.mjs" }
}
```

**Step 3.** Create `mcp-servers/utils/server.mjs`:

```javascript
// mcp-servers/utils/server.mjs — a small, dependency-light MCP server (stateless Streamable HTTP)
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.PORT ?? 3002);
const HOST = process.env.HOST ?? '127.0.0.1';
const API_KEY = process.env.UTILS_MCP_API_KEY ?? '';

// Fixed demo rates (units per 1 USD). Clearly NOT live market data.
const RATES = { USD: 1, INR: 88, EUR: 0.86, GBP: 0.75 };
const CURRENCIES = Object.keys(RATES);

const TOOLS = [
  {
    name: 'convert_currency',
    description: 'Convert an amount between INR, USD, EUR and GBP using fixed demo exchange rates (not live data).',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', minimum: 0 },
        from: { type: 'string', enum: CURRENCIES },
        to: { type: 'string', enum: CURRENCIES },
      },
      required: ['amount', 'from', 'to'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'current_time',
    description: 'Return the current date and time in an IANA timezone such as Asia/Kolkata.',
    inputSchema: {
      type: 'object',
      properties: { timezone: { type: 'string', default: 'UTC' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'echo',
    description: 'Echo the given text back (demonstrates tool-name collisions across servers).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 2000 } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sleep',
    description: 'Wait for the given number of seconds (0-60) before replying (demonstrates gateway timeouts).',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: 0, maximum: 60 } },
      required: ['seconds'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

async function runTool(name, args) {
  switch (name) {
    case 'convert_currency': {
      const { amount, from, to } = args;
      if (typeof amount !== 'number' || amount < 0 || !RATES[from] || !RATES[to]) {
        return fail('amount must be a non-negative number and from/to one of ' + CURRENCIES.join(', '));
      }
      const converted = Math.round((amount / RATES[from]) * RATES[to] * 100) / 100;
      return ok({ amount, from, to, converted, note: 'fixed demo rates' });
    }
    case 'current_time': {
      const timezone = typeof args.timezone === 'string' ? args.timezone : 'UTC';
      try {
        const formatted = new Date().toLocaleString('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' });
        return ok({ timezone, now: formatted, utc: new Date().toISOString() });
      } catch {
        return fail(`Unknown timezone "${timezone}"`);
      }
    }
    case 'echo':
      return typeof args.text === 'string' ? ok({ echo: args.text, from: 'utils' }) : fail('text must be a string');
    case 'sleep': {
      const seconds = Number(args.seconds);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 60) return fail('seconds must be an integer 0-60');
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return ok({ sleptSeconds: seconds });
    }
    default:
      return fail(`Unknown tool "${name}"`);
  }
}

function buildServer() {
  const server = new Server({ name: 'urumi-utils', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => runTool(req.params.name, req.params.arguments ?? {}));
  return server;
}

function keyMatches(req) {
  if (!API_KEY) return true; // no key configured → open (local dev only)
  const got = Buffer.from(String(req.headers['x-api-key'] ?? ''));
  const want = Buffer.from(API_KEY);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readJson(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') return send(res, 200, { status: 'ok' });
    if (path !== '/mcp') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!keyMatches(req)) return send(res, 401, { error: 'invalid api key' });

    let body;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
    }

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('[utils] request failed', err);
      if (!res.headersSent) send(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  })
  .listen(PORT, HOST, () => console.log(`[utils] MCP server on http://${HOST}:${PORT}/mcp`));
```

**Step 4.** Run it with the same key as `UTILS_MCP_API_KEY` in `gateway/.env`:

```powershell
PS> $env:UTILS_MCP_API_KEY = "<same value as gateway/.env>"; npm start
```

> ✅ **Validate**
> Within ~15 s (one health interval), or immediately via the admin refresh:
> ```powershell
> PS> $utils = (Invoke-RestMethod "$base/api/upstreams" -Headers $adminH) | Where-Object slug -eq 'utils'
> PS> Invoke-RestMethod -Method Post "$base/api/upstreams/$($utils.id)/refresh" -Headers $adminH | Select-Object status, tools
> ```
> `status: connected`, and the tools are `utils__convert_currency`, `utils__current_time`, `utils__echo` and `utils__sleep`.

---

### Lesson 13.3 — Upstream #3: the official `everything` reference server (added by URL, like an admin would)

⏱ ~20 min — **Goal:** A third-party MCP server, registered through the API rather than a seed, which proves "add server by URL"

**Step 1.** In a new terminal, run the reference server on port **3003** (3001 is your adapter):

```powershell
PS> $env:PORT = 3003; npx -y @modelcontextprotocol/server-everything streamableHttp
```

Read its startup log and confirm the **port and path** it prints (usually `/mcp`).

**Step 2.** Register it as admin. This is the "add server by URL" user story:

```powershell
PS> $body = @{ slug = "everything"; name = "Everything (reference)"; url = "http://127.0.0.1:3003/mcp"; authType = "none" } | ConvertTo-Json
PS> Invoke-RestMethod -Method Post "$base/api/upstreams" -Headers $adminH -ContentType "application/json" -Body $body | Select-Object status, @{n='tools';e={$_.tools.name}}
```

> ✅ **Validate**
> `status: connected` with tools such as `everything__echo` and `everything__add`. Now `tools/list` with B's key shows **both** `utils__echo` and `everything__echo`, so the **collision is handled by namespacing**. Call both and see different `from` values.

> ⚠️ **Heads up — if `everything` won't start or connect (time-box: 30 minutes)**
> The reference server's CLI flags change between releases (`streamableHttp` vs `streamable-http`). Check `npx -y @modelcontextprotocol/server-everything --help`. If it still fails, **use a public remote server instead**: DeepWiki speaks Streamable HTTP with no auth:
> ```powershell
> PS> $body = @{ slug = "deepwiki"; name = "DeepWiki"; url = "https://mcp.deepwiki.com/mcp"; authType = "none" } | ConvertTo-Json
> PS> Invoke-RestMethod -Method Post "$base/api/upstreams" -Headers $adminH -ContentType "application/json" -Body $body
> ```
> It passes the SSRF guard because it resolves to public IPs. In Kubernetes it needs internet egress. Either way you have three upstreams.

> 💡 **What just happened?**
> Two upstreams came from **config seeds** (operator-owned, reproducible), and one came from the **admin API** (runtime, SSRF-checked). Both paths end in the same table and the same encryption.

---

### Lesson 13.4 — Prove failure isolation and timeouts locally

⏱ ~15 min — **Goal:** Rehearse three definition-of-done checks before Kubernetes

**Test A — slow upstream (timeout):**

```powershell
PS> $slow = '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"utils__sleep","arguments":{"seconds":25}}}'
PS> Measure-Command { (Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body $slow).result.content[0].text } | Select-Object TotalSeconds
```

After ~15 s you get `Upstream "Utilities" did not respond within 15s`. While that call is waiting, run `woo__list_products` in another terminal and it returns instantly. **Slow server isolated.**

**Test B — dead upstream:** stop the utils server (Ctrl+C). Then:

```powershell
PS> $list = Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
PS> $list.result.tools.name          # within ~10s the utils__* tools disappear, woo__* remain
PS> $echo = '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"utils__echo","arguments":{"text":"hi"}}}'
PS> (Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body $echo).result.content[0].text
```

You get `Upstream "Utilities" is unreachable (ECONNREFUSED)`. `GET /api/upstreams` shows `unreachable` with that reason. Restart utils, and it returns to `connected` within one interval. **Self-healing, no gateway restart.**

**Test C — disable:**

```powershell
PS> Invoke-RestMethod -Method Patch "$base/api/upstreams/$($utils.id)" -Headers $adminH -ContentType "application/json" -Body '{"enabled":false}' | Select-Object status
PS> (Invoke-RestMethod -Method Post "$base/mcp" -Headers $mcpH -ContentType "application/json" -Body $echo).result.content[0].text
PS> Invoke-RestMethod -Method Patch "$base/api/upstreams/$($utils.id)" -Headers $adminH -ContentType "application/json" -Body '{"enabled":true}' | Select-Object status
```

While disabled: `Server "Utilities" is disabled by an administrator`, and the audit shows `denied`.

> ✅ **Validate**
> `Invoke-RestMethod "$base/api/audit" -Headers $adminH | Format-Table` shows `success`, `error` (timeout and unreachable) and `denied` rows, all attributed to `userb@urumi.local`.

---

### Lesson 13.5 — Connect real clients: MCP Inspector and Claude Code

⏱ ~20 min — **Goal:** The "user B external client" part of the definition of done, locally

**MCP Inspector:**

```powershell
PS> npx @modelcontextprotocol/inspector
```

In the browser UI: Transport **Streamable HTTP**, URL `http://localhost:3000/mcp`, and under Authentication / Headers add `Authorization: Bearer <B's mcpk_ key>`. Click **Connect** → **Tools** → **List Tools**. Run `woo__list_orders`.

**Claude Code** (any terminal):

```powershell
PS> claude mcp add --transport http urumi http://localhost:3000/mcp --header "Authorization: Bearer <B's mcpk_ key>"
PS> claude
> /mcp            # shows "urumi" connected with N tools
> What orders came in today, and what's their total in EUR?
```

Claude should call `woo__list_orders` and then `utils__convert_currency`. **That's the two-upstream prompt from the definition of done.**

**A scripted smoke check** (handy for the demo and for Part 4). Create `gateway/scripts/smoke-gateway.ts`:

```typescript
// gateway/scripts/smoke-gateway.ts
// Usage: $env:GATEWAY_KEY="mcpk_..."; npm run smoke -- woo__list_products per_page=2
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.GATEWAY_URL ?? 'http://localhost:3000/mcp';
const key = process.env.GATEWAY_KEY;
if (!key) {
  console.error('Set GATEWAY_KEY to a member API key (mcpk_...)');
  process.exit(1);
}

function parseArgs(pairs: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const pair of pairs) {
    const [k, ...rest] = pair.split('=');
    const raw = rest.join('=');
    try {
      args[k!] = JSON.parse(raw);
    } catch {
      args[k!] = raw;
    }
  }
  return args;
}

const client = new Client({ name: 'urumi-smoke', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }),
);
const { tools } = await client.listTools();
console.log(`${tools.length} tools via ${url}`);
for (const tool of tools) console.log(`  - ${tool.name}`);

const [toolName, ...pairs] = process.argv.slice(2);
if (toolName) {
  const result = await client.callTool({ name: toolName, arguments: parseArgs(pairs) });
  console.log(JSON.stringify(result, null, 2));
}
await client.close();
```

```powershell
PS> cd gateway
PS> $env:GATEWAY_KEY = $keyB.key; npm run smoke -- utils__convert_currency amount=199 from=INR to=EUR
```

> ✅ **Validate — Part 2 checkpoint**
> - Inspector and Claude Code both connect with **only** the gateway URL + B's key, and see `woo__*`, `utils__*` and `everything__*` (or `deepwiki__*`).
> - Claude answers the two-server question.
> - The audit log shows every call as `userb@urumi.local`.
> - `npm run typecheck` and `npm test` both pass.
>
> **Commit:** `git add -A; git commit -m "gateway: auth, keys, upstreams, router, audit, /mcp"`

> ⚠️ **Heads up**
> - Claude Code says it "needs authentication" or tries OAuth: check the header syntax and that the key isn't revoked. The gateway answers 401 without a `WWW-Authenticate` challenge, so a good key never triggers OAuth discovery.
> - Inspector `TypeError: Failed to fetch`: it runs in your browser, so CORS applies when you connect directly. Use Inspector's **proxy** mode (the default), not direct mode.

### The final `app.module.ts` after Part 2

```typescript
// gateway/src/app.module.ts  (end of Part 2; Part 3 adds ChatController + ChatService)
import { Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { BootstrapService } from './bootstrap.service.js';
import { HealthController } from './health.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { MembersController } from './auth/members.controller.js';
import { KeysService } from './keys/keys.service.js';
import { KeysController } from './keys/keys.controller.js';
import { UpstreamsService } from './upstreams/upstreams.service.js';
import { UpstreamPool } from './upstreams/upstream-pool.js';
import { UpstreamHealthService } from './upstreams/upstream-health.service.js';
import { UpstreamsController } from './upstreams/upstreams.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuditController } from './audit/audit.controller.js';
import { ToolRouter } from './router/tool-router.service.js';
import { McpController } from './mcp/mcp.controller.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    MembersController,
    KeysController,
    UpstreamsController,
    AuditController,
    McpController,
  ],
  providers: [
    { provide: CONFIG, useFactory: loadConfig },
    DbService,
    BootstrapService,
    AuthService,
    KeysService,
    UpstreamsService,
    UpstreamPool,
    UpstreamHealthService,
    AuditService,
    ToolRouter,
  ],
})
export class AppModule {}
```

---

## End of Part 2 — what you've built

- A NestJS gateway that is an **MCP server** (stateless, JSON responses) and an **MCP client** (pooled, timed-out, self-healing) at once.
- **Identity**: admin seed, invite links, scrypt passwords, hashed revocable sessions, roles with guards.
- **API keys**: 256-bit, SHA-256 at rest, shown once, revocable by owner or admin, effective on the next request.
- **Upstreams**: CRUD, slug-based **namespacing**, AES-GCM-encrypted credentials (bearer or custom header), SSRF guard with an allowlist, seeding from config.
- **Failure isolation**: per-upstream timeouts, snapshot cache, in-flight dedupe, drop-on-error reconnects, readable reasons.
- **Audit**: every call, including denied ones, attributed to the right user, with an admin stats view.

### If an interviewer asks…

**"Walk me through what happens when an MCP client calls a tool through your gateway."**
The client POSTs JSON-RPC `tools/call` to `/mcp` with `Authorization: Bearer mcpk_…`. I hash the key, look it up by index, and reject if it's unknown, revoked or the user is disabled. A revoked key on a tool call is still audited as denied for that user. Then I build a fresh low-level MCP `Server` bound to that user and hand the request to a stateless Streamable HTTP transport. The CallTool handler calls `ToolRouter.callTool`, which splits the name at the first `__` to get the slug, loads the upstream by slug, and denies if it's disabled. Otherwise it gets a pooled MCP `Client` whose transport carries the decrypted upstream credential, and calls the original tool name with a 15-second timeout. The result or a readable error goes back as a tool result, and an audit row records user, server, tool, duration and outcome.

**"How do you handle two servers with the same tool name?"**
Namespacing by construction: every tool is exposed as `slug__tool`. Slugs can't contain underscores and are immutable, so names are stable and parsing is unambiguous. I demonstrate it with `utils__echo` and `everything__echo`.

**"What stops a slow server from hurting everyone?"**
Every upstream request has its own timeout (4 s for listing, 15 s for calls, both Helm values). Listing uses cached snapshots and never-rejecting refreshes. Calls are independent promises, so one hung server only affects calls to that server, and those fail with a message naming it.

**"Why stateless MCP?"**
No session affinity needed. Any replica can serve any request, a pod restart loses nothing, and there's no session store to run. The trade-off is no server-push `list_changed` notifications, so clients see list changes on their next `tools/list`, and the router rejects calls to disabled servers regardless.

When you're ready, open **Part 3**.
