import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { BootstrapService } from './bootstrap.service.js';
import { UpstreamStatusService } from './upstreams/upstream-status.service.js';
import { CONFIG, type AppConfig } from './config.js';

try {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.useBodyParser('json', { limit: '1mb' });
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  await app.init();
  // Schema, first admin and seeded upstreams are in place before any traffic arrives.
  await app.get(BootstrapService).run();
  app.get(UpstreamStatusService).start();
  const { port } = app.get<AppConfig>(CONFIG);
  await app.listen(port, '0.0.0.0');
  console.log(`Gateway listening on port ${port}.`);
} catch (error) {
  console.error('Gateway failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
}
