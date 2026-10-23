import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONFIG, type AppConfig, type AuthType, type SeedUpstream } from '../config.js';
import { DbService } from '../db/db.service.js';
import { decryptSecret, encryptSecret } from '../common/crypto.js';
import { assertSafeUpstreamUrl } from './ssrf.js';
import { SLUG_PATTERN } from './tool-names.js';

export interface Upstream {
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

export interface UpstreamInput {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  headerName?: string | null;
  credential?: string | null;
}

export interface UpstreamPatch {
  name?: string;
  url?: string;
  authType?: AuthType;
  headerName?: string | null;
  /** Omit to keep the stored credential, send null or "" to clear it. */
  credential?: string | null;
  enabled?: boolean;
}

const COLUMNS = `id, slug, name, url, auth_type AS "authType", auth_header_name AS "authHeaderName",
  auth_secret_enc AS "authSecretEnc", enabled, created_at AS "createdAt", updated_at AS "updatedAt"`;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'accept', 'connection', 'cookie', 'mcp-session-id', 'mcp-protocol-version']);
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UpstreamsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  list(): Promise<Upstream[]> {
    return this.db.query<Upstream>(`SELECT ${COLUMNS} FROM upstreams ORDER BY created_at`);
  }

  listEnabled(): Promise<Upstream[]> {
    return this.db.query<Upstream>(`SELECT ${COLUMNS} FROM upstreams WHERE enabled ORDER BY created_at`);
  }

  async get(id: string): Promise<Upstream> {
    const row = await this.db.one<Upstream>(`SELECT ${COLUMNS} FROM upstreams WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException('Upstream not found.');
    return row;
  }

  findBySlug(slug: string): Promise<Upstream | null> {
    return this.db.one<Upstream>(`SELECT ${COLUMNS} FROM upstreams WHERE slug = $1`, [slug]);
  }

  async create(input: UpstreamInput, trusted = false): Promise<Upstream> {
    if (!SLUG_PATTERN.test(input.slug)) throw new BadRequestException('Slugs are 2-20 lowercase letters or digits, starting with a letter.');
    if (!trusted) await assertSafeUpstreamUrl(input.url, this.config);
    const auth = this.resolveAuth(input.authType, input.headerName ?? null, null, input.credential);
    const row = await this.db.one<Upstream>(
      `INSERT INTO upstreams (slug, name, url, auth_type, auth_header_name, auth_secret_enc)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [input.slug, input.name, input.url, auth.authType, auth.headerName, auth.secretEnc],
    ).catch((error: { code?: string }) => {
      if (error.code === UNIQUE_VIOLATION) throw new ConflictException(`The slug "${input.slug}" is already in use.`);
      throw error;
    });
    return row!;
  }

  async update(id: string, patch: UpstreamPatch): Promise<Upstream> {
    const current = await this.get(id);
    if (patch.url !== undefined && patch.url !== current.url) await assertSafeUpstreamUrl(patch.url, this.config);
    const auth = this.resolveAuth(
      patch.authType ?? current.authType,
      patch.headerName !== undefined ? patch.headerName : current.authHeaderName,
      current.authSecretEnc,
      patch.credential,
    );
    const row = await this.db.one<Upstream>(
      `UPDATE upstreams SET name = $2, url = $3, auth_type = $4, auth_header_name = $5, auth_secret_enc = $6,
              enabled = $7, updated_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, patch.name ?? current.name, patch.url ?? current.url, auth.authType, auth.headerName, auth.secretEnc, patch.enabled ?? current.enabled],
    );
    return row!;
  }

  async remove(id: string): Promise<void> {
    if (!await this.db.one('DELETE FROM upstreams WHERE id = $1 RETURNING id', [id])) throw new NotFoundException('Upstream not found.');
  }

  /** Decrypted only in memory, right before talking to the upstream. */
  authHeaders(upstream: Upstream): Record<string, string> {
    if (upstream.authType === 'none' || !upstream.authSecretEnc) return {};
    const secret = decryptSecret(upstream.authSecretEnc, this.config.encryptionKey);
    return upstream.authType === 'bearer' ? { Authorization: `Bearer ${secret}` } : { [upstream.authHeaderName!]: secret };
  }

  /** The only shape that leaves the server: it says whether a credential exists, never what it is. */
  toPublic(upstream: Upstream) {
    const { authSecretEnc, ...rest } = upstream;
    return { ...rest, hasCredential: authSecretEnc !== null };
  }

  /** Seeds run once per slug, so an admin deleting a seeded server is respected after restarts. */
  async seed(seed: SeedUpstream): Promise<void> {
    const key = `seed:${seed.slug}`;
    if (await this.db.one('SELECT 1 FROM bootstrap_state WHERE key = $1', [key])) return;
    const credential = seed.secretEnv ? process.env[seed.secretEnv]?.trim() : undefined;
    if (seed.authType !== 'none' && !credential) throw new Error(`Seed upstream "${seed.slug}" needs ${seed.secretEnv ?? 'secretEnv'}.`);
    try {
      await this.create({ ...seed, credential }, true);
      console.log(`Registered upstream "${seed.slug}".`);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
    }
    await this.db.query('INSERT INTO bootstrap_state (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  }

  private resolveAuth(authType: AuthType, headerName: string | null, storedSecret: string | null, credential: string | null | undefined) {
    if (authType === 'none') return { authType, headerName: null, secretEnc: null };
    let secretEnc = storedSecret;
    if (credential === null || credential === '') secretEnc = null;
    else if (credential !== undefined) secretEnc = encryptSecret(credential, this.config.encryptionKey);
    if (!secretEnc) throw new BadRequestException(`A credential is required for "${authType}" authentication.`);
    if (authType === 'bearer') return { authType, headerName: null, secretEnc };
    if (!headerName || !HEADER_NAME.test(headerName) || RESERVED_HEADERS.has(headerName.toLowerCase())) {
      throw new BadRequestException('Provide a valid custom header name (letters, digits and "-").');
    }
    return { authType, headerName, secretEnc };
  }
}
