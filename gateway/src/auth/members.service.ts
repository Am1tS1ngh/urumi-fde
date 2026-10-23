import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { hashPassword, randomToken, sha256 } from '../common/crypto.js';
import { AuthService } from './auth.service.js';
import { toAuthUser, type AuthUser, type Role } from './auth.types.js';

const INVITE_DAYS = 7;
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class MembersService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async invite(actor: AuthUser, email: string, role: Role) {
    const normalized = email.toLowerCase();
    if (await this.db.one('SELECT 1 FROM users WHERE email = $1', [normalized])) {
      throw new ConflictException('A user with this email already exists.');
    }
    const token = randomToken('inv_');
    const row = await this.db.one<{ id: string; expires_at: Date }>(
      `INSERT INTO invites (email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id, expires_at`,
      [normalized, role, sha256(token), actor.id, INVITE_DAYS],
    );
    // The raw token only ever appears in this response; the database keeps its hash.
    return { id: row!.id, email: normalized, role, inviteUrl: `${this.config.publicUrl}/invite/${token}`, expiresAt: row!.expires_at };
  }

  async acceptInvite(token: string, name: string, password: string) {
    // Claiming the invite in one statement means a link can only be used once.
    const invite = await this.db.one<{ email: string; role: Role }>(
      `UPDATE invites SET accepted_at = now()
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        RETURNING email, role`,
      [sha256(token)],
    );
    if (!invite) throw new BadRequestException('This invite is invalid, expired or already used.');

    const row = await this.db.one<{ id: string; email: string; name: string; role: string }>(
      'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [invite.email, name, invite.role, await hashPassword(password)],
    ).catch((error: { code?: string }) => {
      if (error.code === UNIQUE_VIOLATION) throw new ConflictException('A user with this email already exists.');
      throw error;
    });
    const user = toAuthUser(row!);
    return { token: await this.auth.createSession(user.id), user };
  }

  list() {
    return this.db.query(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at AS "createdAt",
              count(k.id) FILTER (WHERE k.revoked_at IS NULL)::int AS "activeKeys"
         FROM users u LEFT JOIN api_keys k ON k.user_id = u.id
        GROUP BY u.id ORDER BY u.created_at`,
    );
  }

  pendingInvites() {
    return this.db.query(
      `SELECT id, email, role, expires_at AS "expiresAt" FROM invites
        WHERE accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    );
  }

  async update(actor: AuthUser, id: string, patch: { role?: Role; status?: 'active' | 'disabled' }) {
    if (id === actor.id) throw new BadRequestException('You cannot change your own role or status.');
    const row = await this.db.one(
      `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status)
        WHERE id = $1 RETURNING id, email, name, role, status`,
      [id, patch.role ?? null, patch.status ?? null],
    );
    if (!row) throw new NotFoundException('User not found.');
    if (patch.status === 'disabled') await this.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return row;
  }
}
