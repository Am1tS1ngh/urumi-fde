import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { hashPassword } from './common/crypto.js';
import { UpstreamsService } from './upstreams/upstreams.service.js';

@Injectable()
export class BootstrapService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async run(): Promise<void> {
    await this.migrateWhenReady();
    await this.seedAdmin();
    for (const seed of this.config.seedUpstreams) await this.upstreams.seed(seed);
  }

  // On a fresh install the database often starts after the gateway, so wait for it.
  private async migrateWhenReady(attempts = 30): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.db.migrate();
        return;
      } catch (error) {
        if (attempt >= attempts) throw error;
        console.warn(`Database not ready (attempt ${attempt}/${attempts}).`);
        await sleep(2_000);
      }
    }
  }

  private async seedAdmin(): Promise<void> {
    if (await this.db.one("SELECT 1 FROM users WHERE role = 'admin'")) return;
    const { adminEmail, adminPassword } = this.config;
    if (!adminEmail || !adminPassword) {
      console.warn('No admin exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create one.');
      return;
    }
    if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    await this.db.query(
      "INSERT INTO users (email, name, role, password_hash) VALUES ($1, 'Admin', 'admin', $2) ON CONFLICT (email) DO NOTHING",
      [adminEmail, await hashPassword(adminPassword)],
    );
    console.log(`Created the first admin, ${adminEmail}.`);
  }
}
