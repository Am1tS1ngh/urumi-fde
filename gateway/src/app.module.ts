import { Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { BootstrapService } from './bootstrap.service.js';
import { HealthController } from './health.controller.js';
import { AuthService } from './auth/auth.service.js';
import { MembersService } from './auth/members.service.js';
import { AuthController } from './auth/auth.controller.js';
import { MembersController } from './auth/members.controller.js';
import { KeysService } from './keys/keys.service.js';
import { KeysController } from './keys/keys.controller.js';
import { UpstreamsService } from './upstreams/upstreams.service.js';
import { UpstreamClients } from './upstreams/upstream-clients.js';
import { UpstreamStatusService } from './upstreams/upstream-status.service.js';
import { UpstreamsController } from './upstreams/upstreams.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuditController } from './audit/audit.controller.js';
import { ToolRouter } from './router/tool-router.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ChatController } from './chat/chat.controller.js';

@Module({
  controllers: [
    HealthController, AuthController, MembersController, KeysController,
    UpstreamsController, AuditController, ChatController, McpController,
  ],
  providers: [
    { provide: CONFIG, useFactory: loadConfig },
    DbService, BootstrapService, AuthService, MembersService, KeysService,
    UpstreamsService, UpstreamClients, UpstreamStatusService, AuditService, ToolRouter, ChatService,
  ],
})
export class AppModule {}
