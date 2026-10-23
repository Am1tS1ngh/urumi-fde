import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Tool } from '@modelcontextprotocol/client';
import { CONFIG, type AppConfig } from '../config.js';
import { UpstreamClients } from './upstream-clients.js';
import { UpstreamsService, type Upstream } from './upstreams.service.js';
import { describeUpstreamError } from './upstream-errors.js';
import { exposedName, isExposable } from './tool-names.js';

export type UpstreamState = 'connected' | 'unreachable' | 'disabled' | 'checking';

export interface Snapshot {
  upstream: Upstream;
  state: UpstreamState;
  tools: Tool[];
  skippedTools: string[];
  error: string | null;
  checkedAt: number;
  latencyMs: number | null;
}

// A tool list this fresh is reused instead of asking the upstream again.
const FRESH_FOR_MS = 10_000;

@Injectable()
export class UpstreamStatusService implements OnModuleDestroy {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly inflight = new Map<string, Promise<Snapshot>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(UpstreamsService) private readonly upstreams: UpstreamsService,
    @Inject(UpstreamClients) private readonly clients: UpstreamClients,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.config.healthIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async refreshAll(): Promise<void> {
    try {
      const all = await this.upstreams.list();
      const ids = new Set(all.map(upstream => upstream.id));
      for (const id of this.snapshots.keys()) if (!ids.has(id)) this.snapshots.delete(id);
      await Promise.all(all.map(upstream => this.refresh(upstream)));
    } catch (error) {
      console.error('Upstream health check failed:', error instanceof Error ? error.message : error);
    }
  }

  /** Never rejects: failures become an "unreachable" snapshot. */
  current(upstream: Upstream): Promise<Snapshot> {
    const snapshot = this.snapshots.get(upstream.id);
    const sameConfig = snapshot?.upstream.updatedAt.getTime() === upstream.updatedAt.getTime();
    if (snapshot && sameConfig && Date.now() - snapshot.checkedAt < FRESH_FOR_MS) return Promise.resolve(snapshot);
    return this.refresh(upstream);
  }

  /** Concurrent callers share one check per upstream. */
  refresh(upstream: Upstream): Promise<Snapshot> {
    const running = this.inflight.get(upstream.id);
    if (running) return running;
    const check = this.check(upstream).finally(() => this.inflight.delete(upstream.id));
    this.inflight.set(upstream.id, check);
    return check;
  }

  forget(upstreamId: string): void {
    this.snapshots.delete(upstreamId);
    this.clients.drop(upstreamId);
  }

  view(upstream: Upstream) {
    const snapshot = this.snapshots.get(upstream.id);
    const state: UpstreamState = upstream.enabled ? snapshot?.state ?? 'checking' : 'disabled';
    return {
      state,
      error: state === 'unreachable' ? snapshot?.error ?? null : null,
      checkedAt: snapshot ? new Date(snapshot.checkedAt).toISOString() : null,
      latencyMs: snapshot?.latencyMs ?? null,
      skippedTools: snapshot?.skippedTools ?? [],
      tools: state === 'connected'
        ? snapshot!.tools.map(tool => ({
          name: exposedName(upstream.slug, tool.name),
          description: tool.description ?? '',
          readOnly: tool.annotations?.readOnlyHint ?? null,
        }))
        : [],
    };
  }

  private async check(upstream: Upstream): Promise<Snapshot> {
    const started = Date.now();
    const base = { upstream, tools: [], skippedTools: [], error: null, latencyMs: null };
    let snapshot: Snapshot;
    if (!upstream.enabled) {
      this.clients.drop(upstream.id);
      snapshot = { ...base, state: 'disabled', checkedAt: Date.now() };
    } else {
      try {
        const all = await this.clients.listTools(upstream);
        snapshot = {
          ...base,
          state: 'connected',
          tools: all.filter(tool => isExposable(tool.name)),
          skippedTools: all.filter(tool => !isExposable(tool.name)).map(tool => tool.name),
          checkedAt: Date.now(),
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        snapshot = { ...base, state: 'unreachable', error: describeUpstreamError(upstream.name, error, this.config.listTimeoutMs), checkedAt: Date.now() };
      }
    }
    this.snapshots.set(upstream.id, snapshot);
    return snapshot;
  }
}
