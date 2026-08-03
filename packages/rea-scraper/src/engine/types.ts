import type { QueueJob, QueueStats } from '../queue/types.js';
import type { PropertyRecord } from '../extract/types.js';
import type { RetryAttempt } from '../retry/types.js';

// ── State ─────────────────────────────────────────────────────────────────────
export type EngineStateValue = 'idle' | 'running' | 'paused' | 'stopping' | 'stopped';

// ── Per-job result ─────────────────────────────────────────────────────────────
export interface PipelineResult {
  jobId: string;
  url: string;
  success: boolean;
  record?: PropertyRecord;
  strategy?: string;
  attempts: RetryAttempt[];
  durationMs: number;
  error?: string;
}

// ── Aggregate stats ────────────────────────────────────────────────────────────
export interface EngineStats {
  state: EngineStateValue;
  processed: number;
  failed: number;
  skipped: number;
  totalRetries: number;
  uptimeMs: number;
  throughputPerMin: number;
  concurrency: number;
  avgLatencyMs: number;
  queueStats?: QueueStats;
}

export interface HealthStatus {
  healthy: boolean;
  state: EngineStateValue;
  activeJobs: number;
  queueStats?: QueueStats;
  issues: string[];
}

// ── Event hooks ────────────────────────────────────────────────────────────────
export interface EngineHooks {
  onJobStart?: (job: QueueJob) => void;
  onJobComplete?: (result: PipelineResult) => void;
  onJobFail?: (result: PipelineResult) => void;
  onRetry?: (attempt: RetryAttempt, job: QueueJob) => void;
  onStateChange?: (prev: EngineStateValue, next: EngineStateValue) => void;
  onShutdown?: (stats: EngineStats) => void;
}

// ── Engine config ──────────────────────────────────────────────────────────────
export interface EngineConfig {
  /** Max parallel jobs. Overridden at runtime by ConcurrencyController. Default: 4. */
  concurrency?: number;
  /** How many jobs to dequeue per poll cycle. Default: concurrency * 2. */
  batchSize?: number;
  /** ms between queue-poll cycles when queue is empty. Default: 500. */
  pollIntervalMs?: number;
  /** ms to wait for in-flight jobs during graceful shutdown. Default: 30_000. */
  shutdownTimeoutMs?: number;
  /** Max retry attempts per job. Default: 4. */
  maxAttempts?: number;
  /** Base backoff delay in ms. Default: 500. */
  baseDelayMs?: number;
  /** Max backoff delay in ms. Default: 60_000. */
  maxDelayMs?: number;
}
