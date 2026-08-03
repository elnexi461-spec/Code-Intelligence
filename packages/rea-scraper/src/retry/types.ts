import type { ScraperError } from '../errors/error-types.js';

export type RetryVerdict = 'retry' | 'rotate-proxy' | 'skip' | 'fatal';

export interface RetryAttempt {
  attempt: number;
  error: ScraperError;
  verdict: RetryVerdict;
  delayMs: number;
  totalElapsedMs: number;
}

export interface RetryOutcome<T> {
  success: boolean;
  result?: T;
  attempts: RetryAttempt[];
  finalError?: ScraperError;
  totalElapsedMs: number;
}

export interface RetryManagerOptions {
  /** Max total attempts (including the first). Default: from RetryConfig or 4. */
  maxAttempts?: number;
  /** Base delay for exponential backoff in ms. Default: 500. */
  baseDelayMs?: number;
  /** Cap on computed delay in ms. Default: 60_000. */
  maxDelayMs?: number;
  /**
   * When true, permanently-failed jobs (skip/fatal) throw immediately
   * without retrying. Default: true.
   */
  failFast?: boolean;
}
