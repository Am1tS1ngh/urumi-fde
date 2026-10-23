import * as z from 'zod/v4';

export const CONFIG = Symbol('CONFIG');

export const authTypes = ['none', 'bearer', 'header'] as const;
export type AuthType = (typeof authTypes)[number];

const seedSchema = z.array(z.strictObject({
  slug: z.string(),
  name: z.string(),
  url: z.string(),
  authType: z.enum(authTypes),
  headerName: z.string().optional(),
  // Name of the env var holding the credential, so the seed list itself holds no secrets.
  secretEnv: z.string().optional(),
}));
export type SeedUpstream = z.infer<typeof seedSchema>[number];

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
  llm: { baseUrl: string; model: string; apiKey: string } | null;
}

function optional(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function seeds(): SeedUpstream[] {
  const raw = optional('SEED_UPSTREAMS');
  if (!raw) return [];
  try {
    return seedSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error('SEED_UPSTREAMS must be a JSON array of upstream seeds.');
  }
}

export function loadConfig(): AppConfig {
  const encryptionKey = Buffer.from(required('GATEWAY_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) throw new Error('GATEWAY_ENCRYPTION_KEY must be 32 random bytes, base64 encoded.');

  const timezone = optional('TIMEZONE') ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error(`TIMEZONE "${timezone}" is not a valid IANA time zone.`);
  }

  const llmBaseUrl = optional('LLM_BASE_URL');
  const llmModel = optional('LLM_MODEL');
  const llmApiKey = optional('LLM_API_KEY');

  return {
    port: integer('PORT', 3000, 1, 65535),
    databaseUrl: required('DATABASE_URL'),
    encryptionKey,
    publicUrl: (optional('PUBLIC_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    adminEmail: optional('ADMIN_EMAIL')?.toLowerCase() ?? null,
    adminPassword: optional('ADMIN_PASSWORD'),
    timezone,
    callTimeoutMs: integer('CALL_TIMEOUT_MS', 15_000, 1_000, 120_000),
    listTimeoutMs: integer('LIST_TIMEOUT_MS', 5_000, 500, 60_000),
    healthIntervalMs: integer('HEALTH_INTERVAL_MS', 15_000, 2_000, 600_000),
    allowPrivateUpstreams: optional('ALLOW_PRIVATE_UPSTREAMS') === 'true',
    upstreamAllowHosts: (optional('UPSTREAM_ALLOW_HOSTS') ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    seedUpstreams: seeds(),
    llm: llmBaseUrl && llmModel && llmApiKey ? { baseUrl: llmBaseUrl.replace(/\/+$/, ''), model: llmModel, apiKey: llmApiKey } : null,
  };
}
