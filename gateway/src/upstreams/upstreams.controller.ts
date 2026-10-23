import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import * as z from 'zod/v4';
import { authTypes } from '../config.js';
import { parseBody } from '../common/validation.js';
import { AdminGuard, SessionGuard } from '../auth/guards.js';
import { UpstreamsService, type Upstream } from './upstreams.service.js';
import { UpstreamStatusService } from './upstream-status.service.js';

const createBody = z.strictObject({
  slug: z.string(),
  name: z.string().trim().min(1).max(80),
  url: z.url().max(500),
  authType: z.enum(authTypes).default('none'),
  headerName: z.string().max(64).nullable().optional(),
  credential: z.string().min(1).max(4096).nullable().optional(),
});

const updateBody = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  url: z.url().max(500).optional(),
  authType: z.enum(authTypes).optional(),
  headerName: z.string().max(64).nullable().optional(),
  credential: z.string().max(4096).nullable().optional(),
  enabled: z.boolean().optional(),
});

@Controller('api/upstreams')
@UseGuards(SessionGuard)
export class UpstreamsController {
  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamStatusService) private readonly status: UpstreamStatusService,
  ) {}

  @Get()
  async list() {
    return (await this.upstreams.list()).map(upstream => this.present(upstream));
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() body: unknown) {
    const created = await this.upstreams.create(parseBody(createBody, body));
    await this.status.refresh(created);
    return this.present(created);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const updated = await this.upstreams.update(id, parseBody(updateBody, body));
    await this.status.refresh(updated);
    return this.present(updated);
  }

  @Post(':id/refresh')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async refresh(@Param('id', ParseUUIDPipe) id: string) {
    const upstream = await this.upstreams.get(id);
    this.status.forget(id);
    await this.status.refresh(upstream);
    return this.present(upstream);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.upstreams.remove(id);
    this.status.forget(id);
  }

  private present(upstream: Upstream) {
    return { ...this.upstreams.toPublic(upstream), ...this.status.view(upstream) };
  }
}
