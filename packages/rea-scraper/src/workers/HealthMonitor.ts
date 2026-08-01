import type { WorkerPool } from './WorkerPool.js';
import type { QueueManager } from '../queue/QueueManager.js';
import type { PoolStats } from './types.js';
import { getLogger } from '../logger/Logger.js';

export interface HealthSnapshot {
  timestamp: number;
  pool: PoolStats;
  queue: { pending: number; active: number; completed: number; failed: number; dead: number; total: number };
  pagesPerMinute: number;
  successRate: number;
}

export class HealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshots: HealthSnapshot[] = [];
  private running = false;
  private readonly log = getLogger();
  private readonly intervalMs: number;
  private readonly stalledAfterMs: number;

  constructor(
    private readonly pool: WorkerPool,
    private readonly queue: QueueManager,
    options: { intervalMs?: number; stalledAfterMs?: number } = {},
  ) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.stalledAfterMs = options.stalledAfterMs ?? 120_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.log.info({ intervalMs: this.intervalMs }, 'health monitor started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async snapshot(): Promise<HealthSnapshot> {
    const pool = this.pool.stats;
    const queue = await this.queue.stats();
    const pagesPerMinute = this.calcThroughput();
    const total = pool.jobsCompleted + pool.jobsFailed;
    const successRate = total > 0 ? pool.jobsCompleted / total : 1;

    return { timestamp: Date.now(), pool, queue, pagesPerMinute, successRate };
  }

  getHistory(): HealthSnapshot[] {
    return [...this.snapshots];
  }

  private async check(): Promise<void> {
    const snap = await this.snapshot();
    this.snapshots.push(snap);
    if (this.snapshots.length > 60) this.snapshots.shift(); // keep 10 min at 10s intervals

    this.log.info({
      active: snap.pool.active,
      idle: snap.pool.idle,
      completed: snap.pool.jobsCompleted,
      failed: snap.pool.jobsFailed,
      pagesPerMinute: snap.pagesPerMinute.toFixed(1),
      queuePending: snap.queue.pending,
      successRate: (snap.successRate * 100).toFixed(1) + '%',
    }, 'health check');

    this.detectStalledWorkers();
  }

  private detectStalledWorkers(): void {
    const now = Date.now();
    for (const ws of this.pool.workerStats()) {
      if (ws.status === 'active' && ws.currentJobStartedAt) {
        if (now - ws.currentJobStartedAt > this.stalledAfterMs) {
          this.log.warn({ workerId: ws.workerId, jobId: ws.currentJobId, durationMs: now - ws.currentJobStartedAt }, 'worker stalled');
        }
      }
    }
  }

  private calcThroughput(): number {
    if (this.snapshots.length < 2) return 0;
    const oldest = this.snapshots[0]!;
    const latest = this.snapshots[this.snapshots.length - 1]!;
    const deltaCompleted = latest.pool.jobsCompleted - oldest.pool.jobsCompleted;
    const deltaMs = latest.timestamp - oldest.timestamp;
    if (deltaMs === 0) return 0;
    return deltaCompleted / (deltaMs / 60_000); // per minute
  }
}
