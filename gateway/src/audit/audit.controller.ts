import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, SessionGuard } from '../auth/guards.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AuditService } from './audit.service.js';

@Controller('api/audit')
@UseGuards(SessionGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Admins see every call; members only see their own. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const parsed = Number(limit ?? 100);
    return this.audit.list(Number.isFinite(parsed) ? parsed : 100, user.role === 'admin' ? null : user.id);
  }
}
