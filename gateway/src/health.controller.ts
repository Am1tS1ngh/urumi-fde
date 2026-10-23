import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from './db/db.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  // Liveness never touches the database: a database outage must not restart the gateway.
  @Get('healthz')
  live() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    try {
      await this.db.ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable.');
    }
  }
}
