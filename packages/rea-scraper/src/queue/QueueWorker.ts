import type { QueueManager } from './QueueManager.js';
import type { QueueJob } from './types.js';
import { getLogger } from '../logger/Logger.js';

export type JobHandler = (job: QueueJob) => Promise<void>;

export interface QueueWorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  batchSize?: number;
}

/**
 * Pulls jobs from QueueManager and dispatches them to a handler.
 * Used by the Worker Pool module — kept minimal here (no fetch/extract logic).
 */
export class QueueWorker {
  private running = false;
  private activeCount = 0;
  private readonly log = getLogger();
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly manager: QueueManager,
    private readonly handler: JobHandler,
    options: QueueWorkerOptions = {},
  ) {
    this.concurrency = options.concurrency ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.batchSize = options.batchSize ?? Math.min(options.concurrency ?? 10, 20);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.log.info({ concurrency: this.concurrency }, 'queue worker started');
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Drain: wait for active jobs to finish
    while (this.activeCount > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.log.info('queue worker stopped');
  }

  get isRunning(): boolean { return this.running; }
  get active(): number { return this.activeCount; }

  private async poll(): Promise<void> {
    if (!this.running) return;

    const available = this.concurrency - this.activeCount;
    if (available > 0) {
      const jobs = await this.manager.dequeue({ batchSize: Math.min(available, this.batchSize) });
      for (const job of jobs) {
        this.activeCount++;
        void this.process(job);
      }
    }

    this.pollTimer = setTimeout(() => void this.poll(), this.pollIntervalMs);
  }

  private async process(job: QueueJob): Promise<void> {
    try {
      await this.handler(job);
      await this.manager.complete(job);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn({ jobId: job.id, url: job.url, attempt: job.attempts + 1, err: msg }, 'job failed');
      await this.manager.fail(job, msg);
    } finally {
      this.activeCount--;
    }
  }
}
