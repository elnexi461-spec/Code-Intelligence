import { randomUUID } from 'node:crypto';
import type { IQueue } from './IQueue.js';
import type { QueueJob, QueueStats, EnqueueOptions, DequeueOptions } from './types.js';
import { PriorityQueue } from './PriorityQueue.js';

const DEFAULT_MAX_ATTEMPTS = 5;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

export class InMemoryQueue implements IQueue {
  private jobs: Map<string, QueueJob> = new Map(); // id → job
  private urlIndex: Map<string, string> = new Map(); // normalizedUrl → id
  private pq: PriorityQueue = new PriorityQueue();
  private paused = false;

  async enqueue(url: string, options?: EnqueueOptions): Promise<QueueJob | null> {
    const normalized = normalizeUrl(url);
    const existing = this.urlIndex.get(normalized);
    if (existing) {
      const job = this.jobs.get(existing)!;
      // Re-enqueue only if dead/failed
      if (job.status !== 'dead' && job.status !== 'failed') return null;
    }

    const job: QueueJob = {
      id: randomUUID(),
      url: normalized,
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: options?.metadata,
    };

    this.jobs.set(job.id, job);
    this.urlIndex.set(normalized, job.id);
    this.pq.push(job);
    return job;
  }

  async enqueueBatch(urls: string[], options?: EnqueueOptions): Promise<number> {
    let count = 0;
    for (const url of urls) {
      const r = await this.enqueue(url, options);
      if (r) count++;
    }
    return count;
  }

  async dequeue(options?: DequeueOptions): Promise<QueueJob[]> {
    if (this.paused) return [];
    const batchSize = options?.batchSize ?? 1;
    const result: QueueJob[] = [];
    while (result.length < batchSize && this.pq.size > 0) {
      const job = this.pq.pop()!;
      const current = this.jobs.get(job.id);
      if (!current || current.status !== 'pending') continue;
      current.status = 'active';
      current.updatedAt = Date.now();
      result.push(current);
    }
    return result;
  }

  async complete(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'completed';
    job.updatedAt = Date.now();
  }

  async fail(jobId: string, error: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.attempts++;
    job.lastError = error;
    job.updatedAt = Date.now();
    if (job.attempts >= job.maxAttempts) {
      job.status = 'dead';
    } else {
      job.status = 'failed';
      this.pq.push(job); // re-queue for retry
    }
  }

  async retry(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'pending';
    job.updatedAt = Date.now();
    this.pq.push(job);
  }

  async pause(): Promise<void> { this.paused = true; }
  async resume(): Promise<void> { this.paused = false; }

  async clear(): Promise<void> {
    this.jobs.clear();
    this.urlIndex.clear();
    this.pq = new PriorityQueue();
  }

  async stats(): Promise<QueueStats> {
    const counts = { pending: 0, active: 0, completed: 0, failed: 0, dead: 0, total: 0 };
    for (const job of this.jobs.values()) {
      counts[job.status]++;
      counts.total++;
    }
    // pending in PQ includes failed (re-queued)
    counts.pending = this.pq.size;
    return counts;
  }

  async recoverStale(): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'active') {
        job.status = 'pending';
        job.updatedAt = Date.now();
        this.pq.push(job);
        count++;
      }
    }
    return count;
  }

  async close(): Promise<void> { /* no-op */ }
}
