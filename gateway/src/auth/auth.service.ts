import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../common/crypto.js';
import { toAuthUser, type AuthUser } from './auth.types.js';

const SESSION_HOURS = 12;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  password_hash: string;
}

@Injectable()
export class AuthService {
  // Checked when the email is unknown, so both cases take the same time.
  private readonly decoyHash = hashPassword(randomToken('decoy_'));

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const row = await this.db.one<UserRow>(
      'SELECT id, email, name, role, status, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()],
    );
    const passwordOk = await verifyPassword(password, row?.password_hash ?? await this.decoyHash);
    if (!row || !passwordOk || row.status !== 'active') throw new UnauthorizedException('Invalid email or password.');
    const user = toAuthUser(row);
    return { token: await this.createSession(user.id), user };
  }

  async createSession(userId: string): Promise<string> {
    const token = randomToken('ses_');
    await this.db.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))',
      [userId, sha256(token), SESSION_HOURS],
    );
    return token;
  }

  async userForSession(token: string): Promise<AuthUser | null> {
    if (!token.startsWith('ses_')) return null;
    const row = await this.db.one<UserRow>(
      `SELECT u.id, u.email, u.name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
      [sha256(token)],
    );
    return row ? toAuthUser(row) : null;
  }

  async logout(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }
}
