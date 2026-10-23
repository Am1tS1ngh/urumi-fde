import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { toAuthUser, type AuthUser } from '../auth/auth.types.js';

const MAX_ACTIVE_KEYS = 10;

export type KeyCheck =
  | { kind: 'ok'; user: AuthUser }
  | { kind: 'revoked'; user: AuthUser }
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
    if (!owner) throw new NotFoundException('Active user not found.');
    if (owner.active >= MAX_ACTIVE_KEYS) throw new BadRequestException(`A user can have at most ${MAX_ACTIVE_KEYS} active keys.`);

    const key = randomToken('mcpk_');
    const prefix = key.slice(0, 12);
    const row = await this.db.one<{ id: string; created_at: Date }>(
      'INSERT INTO api_keys (user_id, name, prefix, key_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [userId, name, prefix, sha256(key), createdBy],
    );
    // The full key is returned once and never stored.
    return { id: row!.id, name, prefix, key, createdAt: row!.created_at };
  }

  listFor(userId: string) {
    return this.db.query(
      `SELECT id, name, prefix, created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
  }

  /** Owners can revoke their own keys; admins can revoke anyone's. */
  async revoke(actor: AuthUser, keyId: string): Promise<void> {
    const row = await this.db.one(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND (user_id = $2 OR $3)
        RETURNING id`,
      [keyId, actor.id, actor.role === 'admin'],
    );
    if (!row) throw new NotFoundException('Key not found or already revoked.');
  }

  /** Looked up on every request with no cache, so a revoke applies to the very next call. */
  async check(raw: string | null): Promise<KeyCheck> {
    if (!raw?.startsWith('mcpk_')) return { kind: 'invalid' };
    const row = await this.db.one<{ key_id: string; revoked_at: Date | null; id: string; email: string; name: string; role: string; status: string }>(
      `SELECT k.id AS key_id, k.revoked_at, u.id, u.email, u.name, u.role, u.status
         FROM api_keys k JOIN users u ON u.id = k.user_id
        WHERE k.key_hash = $1`,
      [sha256(raw)],
    );
    if (!row) return { kind: 'invalid' };
    const user = toAuthUser(row);
    if (row.revoked_at || row.status !== 'active') return { kind: 'revoked', user };
    void this.db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id]).catch(() => undefined);
    return { kind: 'ok', user };
  }
}
