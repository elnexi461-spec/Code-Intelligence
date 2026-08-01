export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'dead';

export interface QueueJob {
  id: string;
  url: string;
  priority: number; // lower = higher priority
  attempts: number;
  maxAttempts: number;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
}

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;   // retryable failures still in queue
  dead: number;     // exhausted retries
  total: number;
}

export interface EnqueueOptions {
  priority?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

export interface DequeueOptions {
  batchSize?: number;
}
