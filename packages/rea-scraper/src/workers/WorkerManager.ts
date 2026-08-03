import { WorkerPool } from './WorkerPool.js';
import { Scheduler } from './Scheduler.js';
import { HealthMonitor } from './HealthMonitor.js';
import { JobProcessor } from './JobProcessor.js';
import type { FetchEngine } from '../fetch/FetchEngine.js';
import type { ExtractionEngine } from '../extract/ExtractionEngine.js';
import type { StorageEngine } from '../storage/StorageEngine.js';
import type { QueueManager } from '../queue/QueueManager.js';
import type { WorkerManagerOptions, PoolStats, ProcessResult } from './types.js';
import { getLogger } from '../logger/Logger.js';

export class WorkerManager {
  private readonly pool: WorkerPool;
  private readonly scheduler: Scheduler;
  private readonly healthMonitor: HealthMonitor;
  private readonly log = getLogger();
  private running = false;
  private onResultCallbacks: ((r: ProcessResult) => void)[] = [];

  constructor(
    private readonly queue: QueueManager,
    private readonly fetcher: FetchEngine,
    private readonly extractor: ExtractionEngine,
    private readonly storage: StorageEngine,
    private readonly options: WorkerManagerOptions,
  ) {
    const { concurrency, jobTimeoutMs = 60_000, pollIntervalMs = 200, healthCheckIntervalMs = 10_000, stalledAfterMs = 120_000 } = options;

    // Each worker gets its own JobProcessor (stateless — safe to share processor factory)
    this.pool = new WorkerPool(concurrency, () =>
      new JobProcessor(fetcher, extractor, storage, jobTimeoutMs),
    );

    this.scheduler = new Scheduler(queue, this.pool, {
      pollIntervalMs,
      batchSize: Math.min(concurrency, 20),
      onResult: (r) => this.onResultCallbacks.forEach(cb => cb(r)),
    });

    this.healthMonitor = new HealthMonitor(this.pool, queue, {
      intervalMs: healthCheckIntervalMs,
      stalledAfterMs,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.queue.initialize();
    this.scheduler.start();
    this.healthMonitor.start();
    this.log.info({ concurrency: this.options.concurrency }, 'worker manager started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.log.info('worker manager stopping (draining in-flight jobs)...');
    await this.scheduler.stop();
    this.pool.stopAll();
    this.healthMonitor.stop();
    this.log.info('worker manager stopped');
  }

  pause(): void { this.scheduler.pause(); }
  resume(): void { this.scheduler.resume(); }

  onResult(cb: (r: ProcessResult) => void): void {
    this.onResultCallbacks.push(cb);
  }

  get poolStats(): PoolStats { return this.pool.stats; }

  async fullStats() {
    const pool = this.pool.stats;
    const queue = await this.queue.stats();
    return { pool, queue };
  }

  get isRunning(): boolean { return this.running; }

  /**
   * Run until queue is empty (pending=0 and active=0). Useful for batch jobs.
   */
  async runUntilDone(checkIntervalMs = 500, idleSettleMs = 1000): Promise<void> {
    await this.start();
    let idleSince: number | null = null;

    return new Promise((resolve) => {
      const check = setInterval(async () => {
        const { pending, active } = await this.queue.stats();
        const poolActive = this.pool.stats.active;

        if (pending === 0 && active === 0 && poolActive === 0) {
          if (!idleSince) { idleSince = Date.now(); return; }
          if (Date.now() - idleSince >= idleSettleMs) {
            clearInterval(check);
            await this.stop();
            resolve();
          }
        } else {
          idleSince = null;
        }
      }, checkIntervalMs);
    });
  }
}
