/**
 * Dequeues jobs from QueueManager, runs each through Pipeline with
 * RetryManager, and marks jobs complete/failed in the queue.
 *
 * Back-pressure: uses a Semaphore sized to ConcurrencyController.concurrency
 * so the number of parallel jobs self-adjusts with AIMD.
 */
import type { QueueManager } from '../queue/QueueManager.js';
import type { QueueJob } from '../queue/types.js';
import type { RetryManager } from '../retry/RetryManager.js';
import type { ConcurrencyController } from '../concurrency/ConcurrencyController.js';
import type { Pipeline } from './Pipeline.js';
import type { EngineHooks, PipelineResult } from './types.js';
import { Semaphore } from '../concurrency/Semaphore.js';
import { getLogger } from '../logger/Logger.js';

export class JobManager {
  private readonly log = getLogger();
  private activeJobs = 0;

  constructor(
    private readonly queue: QueueManager,
    private readonly pipeline: Pipeline,
    private readonly retry: RetryManager,
    private readonly concurrency: ConcurrencyController,
    private readonly hooks: EngineHooks = {},
    private readonly batchSize: number = 8,
  ) {}

  get active(): number { return this.activeJobs; }

  /**
   * Poll the queue and dispatch up to one batch of jobs.
   * Returns the number of jobs dispatched.
   */
  async dispatchBatch(): Promise<PipelineResult[]> {
    const limit = this.concurrency.concurrency;
    const available = Math.max(0, limit - this.activeJobs);
    if (available === 0) return [];

    const jobs = await this.queue.dequeue({ batchSize: Math.min(available, this.batchSize) });
    if (jobs.length === 0) return [];

    // Run all jobs in the batch concurrently, capped by a semaphore
    const sem = new Semaphore(jobs.length); // already sized by available slots above
    const results = await Promise.all(jobs.map((job) => sem.run(() => this._process(job))));
    return results;
  }

  private async _process(job: QueueJob): Promise<PipelineResult> {
    this.activeJobs++;
    this.hooks.onJobStart?.(job);
    this.log.debug({ jobId: job.id, url: job.url }, 'job started');

    try {
      const outcome = await this.retry.run(
        () => this.pipeline.run(job),
        job.url,
        {
          onRetry: (info) => {
            this.log.warn({ jobId: job.id, url: job.url, attempt: info.attempt, delayMs: info.delayMs }, 'retrying job');
            this.hooks.onRetry?.(info, job);
          },
          onRotateProxy: async () => {
            this.log.warn({ jobId: job.id }, 'proxy rotation triggered');
          },
        },
      );

      // outcome.result is only set when all attempts succeeded
      const result: PipelineResult = outcome.success && outcome.result
        ? { ...outcome.result, attempts: outcome.attempts, durationMs: outcome.totalElapsedMs }
        : {
            jobId: job.id,
            url: job.url,
            success: false,
            attempts: outcome.attempts,
            durationMs: outcome.totalElapsedMs,
            error: outcome.finalError?.message ?? 'unknown failure',
          };

      if (outcome.success) {
        await this.queue.complete(job);
        this.hooks.onJobComplete?.(result);
        this.log.info({ jobId: job.id, url: job.url, durationMs: result.durationMs }, 'job complete');
      } else {
        const errMsg = result.error ?? 'pipeline failed';
        await this.queue.fail(job, errMsg);
        this.hooks.onJobFail?.(result);
        this.log.warn({ jobId: job.id, url: job.url, error: errMsg }, 'job failed');
      }

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.queue.fail(job, errMsg).catch(() => {});
      const result: PipelineResult = {
        jobId: job.id,
        url: job.url,
        success: false,
        attempts: [],
        durationMs: 0,
        error: errMsg,
      };
      this.hooks.onJobFail?.(result);
      return result;
    } finally {
      this.activeJobs--;
    }
  }
}
