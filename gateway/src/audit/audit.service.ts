import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import type { AuthUser } from '../auth/auth.types.js';

export type AuditSource = 'mcp' | 'chat';

export interface AuditEntry {
  user: AuthUser;
  source: AuditSource;
  upstream: { id: string; name: string } | null;
  toolName: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'denied';
  detail?: string | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** A failed audit write is logged but never fails the tool call that already happened. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit_log (user_id, user_email, source, upstream_id, upstream_name, tool_name, duration_ms, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.user.id, entry.user.email, entry.source, entry.upstream?.id ?? null, entry.upstream?.name ?? null,
          entry.toolName, Math.round(entry.durationMs), entry.outcome, entry.detail?.slice(0, 500) ?? null],
      );
    } catch (error) {
      console.error('Could not write audit record:', error instanceof Error ? error.message : error);
    }
  }

  list(limit: number, userId: string | null) {
    return this.db.query(
      `SELECT id, at, user_id AS "userId", user_email AS "userEmail", source, upstream_name AS "upstreamName",
              tool_name AS "toolName", duration_ms AS "durationMs", outcome, detail
         FROM audit_log
        WHERE $1::uuid IS NULL OR user_id = $1::uuid
        ORDER BY at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 500)],
    );
  }
}
