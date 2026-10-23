import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import * as z from 'zod/v4';
import { parseBody } from '../common/validation.js';
import { CurrentUser, SessionGuard } from '../auth/guards.js';
import type { AuthUser } from '../auth/auth.types.js';
import { KeysService } from './keys.service.js';

export const createKeyBody = z.strictObject({ name: z.string().trim().min(1).max(60) });

@Controller('api/keys')
@UseGuards(SessionGuard)
export class KeysController {
  constructor(@Inject(KeysService) private readonly keys: KeysService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.keys.listFor(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.keys.create(user.id, parseBody(createKeyBody, body).name, user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.keys.revoke(user, id);
  }
}
