import Database from 'better-sqlite3';
import type { Database as DB, Statement } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IQueue } from './IQueue.js';
import type { QueueJob, QueueStats, EnqueueOptions, DequeueOptions } from './types.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  priority    INTEGER NOT NULL DEFAULT 0,
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_error  TEXT,
  metadata    TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);
`;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

function rowToJob(row: Record<string, unknown>): QueueJob {
  return {
    id: row['id'] as string,
    url: row['url'] as string,
    priority: row['priority'] as number,
    attempts: row['attempts'] as number,
    maxAttempts: row['max_attempts'] as number,
    status: row['status'] as QueueJob['status'],
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
    lastError: (row['last_error'] as string | null) ?? undefined,
    metadata: row['metadata'] ? JSON.parse(row['metadata'] as string) as Record<string, unknown> : undefined,
  };
}

export class SqliteQueue implements IQueue {
  private readonly db: DB;
  private paused = false;

  // Prepared statements
  private readonly stmtInsert: Statement;
  private readonly stmtFindByUrl: Statement;
  private readonly stmtDequeue: Statement;
  private readonly stmtUpdateStatus: Statement;
  private readonly stmtFail: Statement;
  private readonly stmtStats: Statement;
  private readonly stmtRecoverStale: Statement;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -16000'); // 16MB
    this.db.exec(SCHEMA);

    this.stmtInsert = this.db.prepare(`
      INSERT OR IGNORE INTO jobs (id, url, priority, attempts, max_attempts, status, created_at, updated_at, metadata)
      VALUES (@id, @url, @priority, 0, @max_attempts, 'pending', @created_at, @updated_at, @metadata)
    `);

    this.stmtFindByUrl = this.db.prepare(
      `SELECT * FROM jobs WHERE url = ?`,
    );

    this.stmtDequeue = this.db.prepare(`
      UPDATE jobs SET status = 'active', updated_at = ?
      WHERE id IN (
        SELECT id FROM jobs WHERE status = 'pending'
        ORDER BY priority ASC, created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    this.stmtUpdateStatus = this.db.prepare(`
      UPDATE jobs SET status = @status, updated_at = @updated_at WHERE id = @id
    `);

    this.stmtFail = this.db.prepare(`
      UPDATE jobs
      SET attempts = attempts + 1,
          last_error = @last_error,
          updated_at = @updated_at,
          status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'pending' END
      WHERE id = @id
    `);

    this.stmtStats = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM jobs GROUP BY status
    `);

    this.stmtRecoverStale = this.db.prepare(`
      UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'active'
    `);
  }

  async enqueue(url: string, options?: EnqueueOptions): Promise<QueueJob | null> {
    const normalized = normalizeUrl(url);
    const existing = this.stmtFindByUrl.get(normalized) as Record<string, unknown> | undefined;
    if (existing) {
      const s = existing['status'] as string;
      if (s !== 'dead' && s !== 'failed') return null;
      // Re-insert as new job for dead/failed
      this.db.prepare(`DELETE FROM jobs WHERE url = ?`).run(normalized);
    }

    const now = Date.now();
    const job: QueueJob = {
      id: randomUUID(),
      url: normalized,
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
    };

    this.stmtInsert.run({
      id: job.id,
      url: job.url,
      priority: job.priority,
      max_attempts: job.maxAttempts,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      metadata: job.metadata ? JSON.stringify(job.metadata) : null,
    });

    return job;
  }

  async enqueueBatch(urls: string[], options?: EnqueueOptions): Promise<number> {
    let count = 0;
    const insertMany = this.db.transaction((batch: string[]) => {
      for (const url of batch) {
        const normalized = normalizeUrl(url);
        const existing = this.stmtFindByUrl.get(normalized) as Record<string, unknown> | undefined;
        if (existing) {
          const s = existing['status'] as string;
          if (s !== 'dead' && s !== 'failed') continue;
          this.db.prepare(`DELETE FROM jobs WHERE url = ?`).run(normalized);
        }
        const now = Date.now();
        const result = this.stmtInsert.run({
          id: randomUUID(),
          url: normalized,
          priority: options?.priority ?? 0,
          max_attempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          created_at: now,
          updated_at: now,
          metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
        });
        if (result.changes > 0) count++;
      }
    });
    insertMany(urls);
    return count;
  }

  async dequeue(options?: DequeueOptions): Promise<QueueJob[]> {
    if (this.paused) return [];
    const batchSize = options?.batchSize ?? 1;
    const rows = this.stmtDequeue.all(Date.now(), batchSize) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }

  async complete(jobId: string): Promise<void> {
    this.stmtUpdateStatus.run({ id: jobId, status: 'completed', updated_at: Date.now() });
  }

  async fail(jobId: string, error: string): Promise<void> {
    this.stmtFail.run({ id: jobId, last_error: error, updated_at: Date.now() });
  }

  async retry(jobId: string): Promise<void> {
    this.stmtUpdateStatus.run({ id: jobId, status: 'pending', updated_at: Date.now() });
  }

  async pause(): Promise<void> { this.paused = true; }
  async resume(): Promise<void> { this.paused = false; }

  async clear(): Promise<void> {
    this.db.prepare(`DELETE FROM jobs`).run();
  }

  async stats(): Promise<QueueStats> {
    const rows = this.stmtStats.all() as { status: string; count: number }[];
    const counts: QueueStats = { pending: 0, active: 0, completed: 0, failed: 0, dead: 0, total: 0 };
    for (const row of rows) {
      const key = row.status as keyof QueueStats;
      if (key in counts) counts[key] = row.count;
      counts.total += row.count;
    }
    return counts;
  }

  async recoverStale(): Promise<number> {
    const result = this.stmtRecoverStale.run(Date.now());
    return result.changes;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
