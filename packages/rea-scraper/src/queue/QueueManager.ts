import type { IQueue } from './IQueue.js';
import type { QueueJob, QueueStats, EnqueueOptions, DequeueOptions } from './types.js';
import { SqliteQueue } from './SqliteQueue.js';
import { InMemoryQueue } from './InMemoryQueue.js';
import { getLogger } from '../logger/Logger.js';

export type QueueBackend = 'sqlite' | 'memory';

export interface QueueManagerOptions {
  backend?: QueueBackend;
  dbPath?: string;
  defaultMaxAttempts?: number;
  defaultBatchSize?: number;
}

/**
 * Façade over IQueue. All consumer code uses QueueManager — never a backend directly.
 */
export class QueueManager {
  private readonly queue: IQueue;
  private readonly log = getLogger();
  private readonly defaultBatchSize: number;

  constructor(options: QueueManagerOptions = {}) {
    const backend = options.backend ?? 'sqlite';
    this.defaultBatchSize = options.defaultBatchSize ?? 20;

    this.queue = backend === 'memory'
      ? new InMemoryQueue()
      : new SqliteQueue(options.dbPath ?? '.rea-scraper/queue.db');
  }

  /** Recover stale active jobs on startup (after crash/restart). */
  async initialize(): Promise<void> {
    const recovered = await this.queue.recoverStale();
    if (recovered > 0) {
      this.log.info({ recovered }, 'recovered stale jobs from previous run');
    }
  }

  async enqueue(url: string, options?: EnqueueOptions): Promise<QueueJob | null> {
    return this.queue.enqueue(url, options);
  }

  async enqueueBatch(urls: string[], options?: EnqueueOptions): Promise<number> {
    const count = await this.queue.enqueueBatch(urls, options);
    this.log.debug({ submitted: urls.length, enqueued: count }, 'batch enqueued');
    return count;
  }

  async dequeue(options?: DequeueOptions): Promise<QueueJob[]> {
    return this.queue.dequeue({
      batchSize: options?.batchSize ?? this.defaultBatchSize,
      ...options,
    });
  }

  async complete(job: QueueJob): Promise<void> {
    return this.queue.complete(job.id);
  }

  async fail(job: QueueJob, error: string): Promise<void> {
    return this.queue.fail(job.id, error);
  }

  async retry(job: QueueJob): Promise<void> {
    return this.queue.retry(job.id);
  }

  async pause(): Promise<void> {
    this.log.info('queue paused');
    return this.queue.pause();
  }

  async resume(): Promise<void> {
    this.log.info('queue resumed');
    return this.queue.resume();
  }

  async clear(): Promise<void> {
    return this.queue.clear();
  }

  async stats(): Promise<QueueStats> {
    return this.queue.stats();
  }

  async close(): Promise<void> {
    return this.queue.close();
  }

  /** Swap backend at runtime (for testing). */
  static withMemory(opts?: Omit<QueueManagerOptions, 'backend'>): QueueManager {
    return new QueueManager({ ...opts, backend: 'memory' });
  }

  static withSqlite(dbPath: string, opts?: Omit<QueueManagerOptions, 'backend' | 'dbPath'>): QueueManager {
    return new QueueManager({ ...opts, backend: 'sqlite', dbPath });
  }
}
