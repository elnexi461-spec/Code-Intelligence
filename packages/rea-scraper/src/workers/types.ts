import type { QueueJob } from '../queue/types.js';

export type WorkerStatus = 'idle' | 'active' | 'stopped' | 'stalled';

export interface WorkerStats {
  workerId: string;
  status: WorkerStatus;
  jobsCompleted: number;
  jobsFailed: number;
  totalProcessingMs: number;
  avgProcessingMs: number;
  lastJobAt?: number;
  currentJobId?: string;
  currentJobStartedAt?: number;
}

export interface PoolStats {
  total: number;
  idle: number;
  active: number;
  stopped: number;
  jobsCompleted: number;
  jobsFailed: number;
  avgProcessingMs: number;
  uptimeMs: number;
}

export interface ProcessResult {
  jobId: string;
  url: string;
  success: boolean;
  durationMs: number;
  strategy?: string;
  error?: string;
}

export interface FetchLike {
  fetch(req: { url: string; sessionId?: string }): Promise<{ url: string; statusCode: number; body: string; headers: Record<string, string>; durationMs: number; sessionId: string; fromCache: boolean }>;
}

export interface WorkerManagerOptions {
  concurrency: number;
  jobTimeoutMs?: number;
  pollIntervalMs?: number;
  healthCheckIntervalMs?: number;
  stalledAfterMs?: number;
}
