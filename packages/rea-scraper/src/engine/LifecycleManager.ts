/**
 * Manages the engine run loop and graceful shutdown.
 *
 * Run loop:
 *   while running: dispatchBatch() → sleep(pollInterval) → repeat
 *   if paused:     sleep until resumed
 *   if stopping:   wait for activeJobs == 0, then transition to stopped
 */
import type { QueueManager } from '../queue/QueueManager.js';
import type { JobManager } from './JobManager.js';
import type { EngineState } from './EngineState.js';
import type { EngineHooks, EngineStats, HealthStatus } from './types.js';
import { getLogger } from '../logger/Logger.js';

export class LifecycleManager {
  private readonly log = getLogger();
  private startedAt = 0;
  private processed = 0;
  private failed = 0;
  private skipped = 0;
  private totalRetries = 0;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(
    private readonly state: EngineState,
    private readonly jobManager: JobManager,
    private readonly queue: QueueManager,
    private readonly hooks: EngineHooks,
    private readonly pollIntervalMs: number = 500,
    private readonly shutdownTimeoutMs: number = 30_000,
  ) {}

  async start(): Promise<void> {
    this.state.transition('running');
    this.startedAt = Date.now();
    this.log.info('engine started');
    this._scheduleNextPoll();
  }

  pause(): void {
    this.state.transition('paused');
    this._cancelPoll();
    this.log.info('engine paused');
  }

  resume(): void {
    this.state.transition('running');
    this.log.info('engine resumed');
    this._scheduleNextPoll();
  }

  /**
   * Signal graceful stop. Returns a promise that resolves when all
   * in-flight jobs finish (or shutdownTimeoutMs elapses).
   */
  async stop(): Promise<void> {
    if (this.state.is('stopped') || this.state.is('stopping')) return;
    const prev = this.state.value;
    if (prev === 'paused') {
      // paused → stopping → stopped directly
      this.state.transition('stopping');
    } else {
      this.state.transition('stopping');
    }
    this._cancelPoll();
    this.log.info({ activeJobs: this.jobManager.active }, 'engine stopping — waiting for in-flight jobs');

    await this._waitForDrain();
    this.state.transition('stopped');
    this.log.info(this.stats(), 'engine stopped');
    this.hooks.onShutdown?.(this.stats());
  }

  stats(): EngineStats {
    const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const throughputPerMin = uptimeMs > 0
      ? Math.round((this.processed / uptimeMs) * 60_000 * 10) / 10
      : 0;
    return {
      state: this.state.value,
      processed: this.processed,
      failed: this.failed,
      skipped: this.skipped,
      totalRetries: this.totalRetries,
      uptimeMs,
      throughputPerMin,
      concurrency: 0, // filled by ScraperEngine
      avgLatencyMs: 0,
    };
  }

  async health(): Promise<HealthStatus> {
    const queueStats = await this.queue.stats().catch(() => undefined);
    const issues: string[] = [];
    if (this.state.is('stopped')) issues.push('engine is stopped');
    return {
      healthy: issues.length === 0,
      state: this.state.value,
      activeJobs: this.jobManager.active,
      queueStats,
      issues,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _scheduleNextPoll(): void {
    if (!this.state.is('running')) return;
    this.pollHandle = setTimeout(() => this._poll(), this.pollIntervalMs);
  }

  private _cancelPoll(): void {
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async _poll(): Promise<void> {
    if (!this.state.is('running')) return;
    try {
      const results = await this.jobManager.dispatchBatch();
      for (const r of results) {
        if (r.success) this.processed++;
        else if (r.error?.includes('skip') || r.error?.includes('Not Found') || r.error?.includes('Gone')) this.skipped++;
        else this.failed++;
        this.totalRetries += r.attempts.length;
      }
    } catch (err) {
      this.log.error({ err }, 'poll cycle error');
    }
    this._scheduleNextPoll();
  }

  private _waitForDrain(): Promise<void> {
    return new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        this.log.warn({ activeJobs: this.jobManager.active }, 'shutdown timeout — forcing stop');
        resolve();
      }, this.shutdownTimeoutMs);

      const check = (): void => {
        if (this.jobManager.active === 0) {
          clearTimeout(deadline);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }
}
