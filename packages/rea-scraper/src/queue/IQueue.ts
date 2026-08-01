import type { QueueJob, QueueStats, EnqueueOptions, DequeueOptions } from './types.js';

export interface IQueue {
  /** Add a single URL. Ignored if URL already exists and is not dead/failed. */
  enqueue(url: string, options?: EnqueueOptions): Promise<QueueJob | null>;
  /** Add multiple URLs. Returns count of actually enqueued (deduped). */
  enqueueBatch(urls: string[], options?: EnqueueOptions): Promise<number>;
  /** Claim next pending job(s), marking them active. */
  dequeue(options?: DequeueOptions): Promise<QueueJob[]>;
  /** Mark a job as completed. */
  complete(jobId: string): Promise<void>;
  /** Increment attempts; if exhausted, mark dead. Otherwise mark failed (retryable). */
  fail(jobId: string, error: string): Promise<void>;
  /** Re-queue a failed job immediately (resets to pending). */
  retry(jobId: string): Promise<void>;
  /** Pause dequeue — enqueue still works. */
  pause(): Promise<void>;
  /** Resume dequeue after pause. */
  resume(): Promise<void>;
  /** Remove all jobs. */
  clear(): Promise<void>;
  /** Return queue statistics. */
  stats(): Promise<QueueStats>;
  /** Release active jobs back to pending (called on startup after crash). */
  recoverStale(): Promise<number>;
  /** Close underlying resources. */
  close(): Promise<void>;
}
