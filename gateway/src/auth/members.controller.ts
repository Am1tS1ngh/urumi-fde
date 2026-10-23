import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import * as z from 'zod/v4';
import { parseBody } from '../common/validation.js';
import { KeysService } from '../keys/keys.service.js';
import { createKeyBody } from '../keys/keys.controller.js';
import { MembersService } from './members.service.js';
import { AdminGuard, CurrentUser, SessionGuard } from './guards.js';
import type { AuthUser } from './auth.types.js';

const inviteBody = z.strictObject({ email: z.email().max(254), role: z.enum(['admin', 'member']).default('member') });
const updateBody = z.strictObject({ role: z.enum(['admin', 'member']).optional(), status: z.enum(['active', 'disabled']).optional() });

@Controller('api/members')
@UseGuards(SessionGuard, AdminGuard)
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(KeysService) private readonly keys: KeysService,
  ) {}

  @Get()
  list() {
    return this.members.list();
  }

  @Get('invites')
  invites() {
    return this.members.pendingInvites();
  }

  @Post('invites')
  invite(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const { email, role } = parseBody(inviteBody, body);
    return this.members.invite(actor, email, role);
  }

  @Patch(':id')
  update(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.members.update(actor, id, parseBody(updateBody, body));
  }

  @Get(':id/keys')
  memberKeys(@Param('id', ParseUUIDPipe) id: string) {
    return this.keys.listFor(id);
  }

  @Post(':id/keys')
  issueKey(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.keys.create(id, parseBody(createKeyBody, body).name, actor.id);
  }
}
