import { randomUUID } from 'node:crypto';
import type { QueueJob } from '../queue/types.js';
import type { JobProcessor } from './JobProcessor.js';
import type { WorkerStats, WorkerStatus, ProcessResult } from './types.js';

export class Worker {
  readonly id: string;
  private _status: WorkerStatus = 'idle';
  private _jobsCompleted = 0;
  private _jobsFailed = 0;
  private _totalMs = 0;
  private _lastJobAt?: number;
  private _currentJobId?: string;
  private _currentJobStartedAt?: number;

  constructor(private readonly processor: JobProcessor) {
    this.id = randomUUID();
  }

  async process(job: QueueJob): Promise<ProcessResult> {
    this._status = 'active';
    this._currentJobId = job.id;
    this._currentJobStartedAt = Date.now();

    const result = await this.processor.process(job);

    this._status = 'idle';
    this._totalMs += result.durationMs;
    this._lastJobAt = Date.now();
    this._currentJobId = undefined;
    this._currentJobStartedAt = undefined;

    if (result.success) this._jobsCompleted++;
    else this._jobsFailed++;

    return result;
  }

  stop(): void { this._status = 'stopped'; }
  markStalled(): void { this._status = 'stalled'; }

  get status(): WorkerStatus { return this._status; }
  get isIdle(): boolean { return this._status === 'idle'; }

  get stats(): WorkerStats {
    const count = this._jobsCompleted + this._jobsFailed;
    return {
      workerId: this.id,
      status: this._status,
      jobsCompleted: this._jobsCompleted,
      jobsFailed: this._jobsFailed,
      totalProcessingMs: this._totalMs,
      avgProcessingMs: count > 0 ? this._totalMs / count : 0,
      lastJobAt: this._lastJobAt,
      currentJobId: this._currentJobId,
      currentJobStartedAt: this._currentJobStartedAt,
    };
  }
}
