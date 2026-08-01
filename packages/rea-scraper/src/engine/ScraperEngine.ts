/**
 * Top-level facade wiring all subsystems together.
 *
 * Usage:
 *   const engine = new ScraperEngine(queue, fetcher, extractor, storage, config, hooks);
 *   await engine.start();
 *   // ... add URLs to queue ...
 *   await engine.stop();
 */
import type { QueueManager } from '../queue/QueueManager.js';
import type { FetchEngine } from '../fetch/FetchEngine.js';
import type { ExtractionEngine } from '../extract/ExtractionEngine.js';
import type { StorageEngine } from '../storage/StorageEngine.js';
import type { EngineConfig, EngineHooks, EngineStats, HealthStatus, PipelineResult } from './types.js';
import { EngineState } from './EngineState.js';
import { Pipeline } from './Pipeline.js';
import { JobManager } from './JobManager.js';
import { LifecycleManager } from './LifecycleManager.js';
import { RetryManager } from '../retry/RetryManager.js';
import { ConcurrencyController } from '../concurrency/ConcurrencyController.js';
import { getLogger } from '../logger/Logger.js';

export class ScraperEngine {
  private readonly log = getLogger();
  private readonly _state = new EngineState();
  private readonly concurrency: ConcurrencyController;
  private readonly retry: RetryManager;
  private readonly pipeline: Pipeline;
  private readonly jobManager: JobManager;
  private readonly lifecycle: LifecycleManager;

  constructor(
    private readonly queue: QueueManager,
    fetcher: FetchEngine,
    extractor: ExtractionEngine,
    storage: StorageEngine,
    config: EngineConfig = {},
    hooks: EngineHooks = {},
  ) {
    const concurrencyOpts = { initial: config.concurrency ?? 4, min: 1, max: 50 };
    this.concurrency = new ConcurrencyController(concurrencyOpts);

    this.retry = new RetryManager(
      {
        maxAttempts: config.maxAttempts ?? 4,
        baseDelayMs: config.baseDelayMs ?? 500,
        maxDelayMs: config.maxDelayMs ?? 60_000,
      },
      this.concurrency,
    );

    this.pipeline = new Pipeline(fetcher, extractor, storage);

    const batchSize = config.batchSize ?? (config.concurrency ?? 4) * 2;
    this.jobManager = new JobManager(
      queue,
      this.pipeline,
      this.retry,
      this.concurrency,
      hooks,
      batchSize,
    );

    this.lifecycle = new LifecycleManager(
      this._state,
      this.jobManager,
      queue,
      {
        ...hooks,
        onStateChange: hooks.onStateChange,
        onShutdown: (stats) => {
          this.log.info(stats, 'engine shutdown complete');
          hooks.onShutdown?.(stats);
        },
      },
      config.pollIntervalMs ?? 500,
      config.shutdownTimeoutMs ?? 30_000,
    );
  }

  /** Initialize queue (recover stale jobs) then start the run loop. */
  async start(): Promise<void> {
    await this.queue.initialize();
    await this.lifecycle.start();
  }

  /** Graceful shutdown: stop accepting new jobs, drain in-flight, persist queue state. */
  async stop(): Promise<void> {
    await this.lifecycle.stop();
    await this.queue.close();
  }

  /** Pause the run loop without losing state. */
  pause(): void {
    this.lifecycle.pause();
  }

  /** Resume after pause. */
  resume(): void {
    this.lifecycle.resume();
  }

  /** Run until the queue is empty, then stop. */
  async runUntilDone(idleSettleMs = 2_000): Promise<void> {
    await this.start();
    await new Promise<void>((resolve) => {
      const check = async (): Promise<void> => {
        if (!this._state.is('running')) { resolve(); return; }
        const stats = await this.queue.stats();
        const idle = (stats.pending === 0 && stats.active === 0) || !stats;
        if (idle && this.jobManager.active === 0) {
          setTimeout(resolve, idleSettleMs); // settle delay
        } else {
          setTimeout(check, 300);
        }
      };
      setTimeout(check, 300);
    });
    await this.stop();
  }

  /** Aggregate runtime statistics. */
  stats(): EngineStats {
    const base = this.lifecycle.stats();
    return {
      ...base,
      concurrency: this.concurrency.concurrency,
      avgLatencyMs: this.concurrency.avgLatencyMs,
    };
  }

  /** Health probe suitable for monitoring. */
  async health(): Promise<HealthStatus> {
    return this.lifecycle.health();
  }

  /** Expose current state value for external checks. */
  get currentState(): EngineState {
    return this._state;
  }
}
