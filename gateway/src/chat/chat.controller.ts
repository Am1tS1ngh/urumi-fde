import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import * as z from 'zod/v4';
import { CONFIG, type AppConfig } from '../config.js';
import { parseBody } from '../common/validation.js';
import { CurrentUser, SessionGuard } from '../auth/guards.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ToolRouter } from '../router/tool-router.service.js';
import { ChatService } from './chat.service.js';

const chatBody = z.strictObject({
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .min(1).max(40)
    .refine(messages => messages.at(-1)?.role === 'user', 'the last message must come from the user'),
});

@Controller('api/chat')
@UseGuards(SessionGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(ToolRouter) private readonly router: ToolRouter,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.chat.chat(user, parseBody(chatBody, body).messages);
  }

  @Get('tools')
  async tools() {
    return {
      configured: this.chat.configured,
      model: this.config.llm?.model ?? null,
      tools: (await this.router.listTools()).map(({ name, upstreamName }) => ({ name, upstreamName })),
    };
  }
}
