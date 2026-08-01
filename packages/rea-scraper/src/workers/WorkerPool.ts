import type { QueueJob } from '../queue/types.js';
import type { JobProcessor } from './JobProcessor.js';
import { Worker } from './Worker.js';
import type { PoolStats, ProcessResult } from './types.js';

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly startedAt = Date.now();

  constructor(concurrency: number, processorFactory: () => JobProcessor) {
    for (let i = 0; i < concurrency; i++) {
      this.workers.push(new Worker(processorFactory()));
    }
  }

  /**
   * Dispatch a job to an idle worker. Returns null if no worker available.
   */
  dispatch(job: QueueJob, onComplete: (result: ProcessResult) => void): boolean {
    const worker = this.workers.find(w => w.isIdle);
    if (!worker) return false;
    void worker.process(job).then(onComplete);
    return true;
  }

  get availableSlots(): number {
    return this.workers.filter(w => w.isIdle).length;
  }

  get stats(): PoolStats {
    const workerStats = this.workers.map(w => w.stats);
    const idle = this.workers.filter(w => w.status === 'idle').length;
    const active = this.workers.filter(w => w.status === 'active').length;
    const stopped = this.workers.filter(w => w.status === 'stopped').length;
    const jobsCompleted = workerStats.reduce((s, w) => s + w.jobsCompleted, 0);
    const jobsFailed = workerStats.reduce((s, w) => s + w.jobsFailed, 0);
    const totalMs = workerStats.reduce((s, w) => s + w.totalProcessingMs, 0);
    const total = jobsCompleted + jobsFailed;

    return {
      total: this.workers.length,
      idle,
      active,
      stopped,
      jobsCompleted,
      jobsFailed,
      avgProcessingMs: total > 0 ? totalMs / total : 0,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  workerStats() {
    return this.workers.map(w => w.stats);
  }

  stopAll(): void {
    for (const w of this.workers) w.stop();
  }

  /** Wait until all active workers become idle. */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.workers.some(w => w.status === 'active')) {
      if (Date.now() > deadline) break;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}
