import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type AppConfig } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

const MIGRATION_LOCK = 727_274;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5_000 });
    this.pool.on('error', error => console.error('Database client error:', error.message));
  }

  async query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(text, params)).rows;
  }

  async one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(text, params))[0] ?? null;
  }

  /** Applies the schema while holding an advisory lock, so parallel replicas take turns. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
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
