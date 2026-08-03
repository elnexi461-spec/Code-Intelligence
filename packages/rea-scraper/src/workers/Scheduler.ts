import type { QueueManager } from '../queue/QueueManager.js';
import type { WorkerPool } from './WorkerPool.js';
import type { ProcessResult } from './types.js';
import { getLogger } from '../logger/Logger.js';

export interface SchedulerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
  onResult?: (result: ProcessResult) => void;
}

export class Scheduler {
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly log = getLogger();
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly onResult?: (r: ProcessResult) => void;

  constructor(
    private readonly queue: QueueManager,
    private readonly pool: WorkerPool,
    options: SchedulerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.batchSize = options.batchSize ?? 10;
    this.onResult = options.onResult;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info({ pollIntervalMs: this.pollIntervalMs }, 'scheduler started');
    void this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.pool.drain();
    this.log.info('scheduler stopped');
  }

  pause(): void { this.paused = true; this.log.info('scheduler paused'); }
  resume(): void { this.paused = false; this.log.info('scheduler resumed'); }

  get isRunning(): boolean { return this.running; }
  get isPaused(): boolean { return this.paused; }

  private async tick(): Promise<void> {
    if (!this.running) return;

    if (!this.paused) {
      const available = this.pool.availableSlots;
      if (available > 0) {
        const jobs = await this.queue.dequeue({
          batchSize: Math.min(available, this.batchSize),
        });

        for (const job of jobs) {
          this.pool.dispatch(job, async (result) => {
            if (result.success) {
              await this.queue.complete(job);
            } else {
              await this.queue.fail(job, result.error ?? 'unknown error');
            }
            this.onResult?.(result);
          });
        }
      }
    }

    this.timer = setTimeout(() => void this.tick(), this.pollIntervalMs);
  }
}
