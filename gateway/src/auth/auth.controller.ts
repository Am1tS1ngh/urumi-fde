import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import * as z from 'zod/v4';
import { parseBody } from '../common/validation.js';
import { AuthService } from './auth.service.js';
import { MembersService } from './members.service.js';
import { CurrentUser, SessionGuard } from './guards.js';
import { bearerToken, type AuthUser } from './auth.types.js';

const loginBody = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(200) });
const acceptInviteBody = z.strictObject({
  token: z.string().startsWith('inv_').max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(12, 'must be at least 12 characters').max(200),
});

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const { email, password } = parseBody(loginBody, body);
    return this.auth.login(email, password);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: Request) {
    await this.auth.logout(bearerToken(req)!);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(@Body() body: unknown) {
    const { token, name, password } = parseBody(acceptInviteBody, body);
    return this.members.acceptInvite(token, name, password);
  }
}
