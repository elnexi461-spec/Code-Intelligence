/**
 * Orchestrates the full retry lifecycle for a single job.
 *
 * Integration points:
 * - Uses RetryClassifier to decide verdict per error
 * - Uses BackoffStrategy for jittered delays
 * - Calls ConcurrencyController.recordSuccess/recordFailure on each outcome
 *   so AIMD adapts concurrency in response to real error rates
 * - Accepts an optional onRotateProxy callback so the caller can swap the proxy
 *   before the next attempt without this module knowing about proxy mechanics
 */
import { RetryClassifier } from './RetryClassifier.js';
import { BackoffStrategy } from './BackoffStrategy.js';
import type { RetryAttempt, RetryOutcome, RetryManagerOptions } from './types.js';
import type { ConcurrencyController } from '../concurrency/ConcurrencyController.js';
import { ScraperError, FetchError } from '../errors/error-types.js';

export interface RetryManagerCallbacks {
  /** Called when the classifier says 'rotate-proxy' so the caller can swap it. */
  onRotateProxy?: () => Promise<void>;
  /** Called before each attempt (for logging, metrics, etc.). */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  /** Called when a retry is scheduled, before the delay sleep. */
  onRetry?: (info: RetryAttempt) => void;
}

export class RetryManager {
  private readonly classifier = new RetryClassifier();
  private readonly backoff: BackoffStrategy;
  private readonly maxAttempts: number;
  private readonly failFast: boolean;

  constructor(
    private readonly options: RetryManagerOptions = {},
    private readonly concurrencyController?: ConcurrencyController,
  ) {
    this.maxAttempts = options.maxAttempts ?? 4;
    this.failFast = options.failFast ?? true;
    this.backoff = new BackoffStrategy({
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
    });
  }

  /**
   * Execute `fn` with automatic retry on transient failures.
   *
   * @param fn  The async operation to retry (e.g. a fetch + parse pipeline).
   * @param url For error classification and logging.
   * @param callbacks Optional hooks for proxy rotation and observability.
   */
  async run<T>(
    fn: () => Promise<T>,
    url: string,
    callbacks: RetryManagerCallbacks = {},
  ): Promise<RetryOutcome<T>> {
    const startedAt = Date.now();
    const attempts: RetryAttempt[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      callbacks.onAttempt?.(attempt, this.maxAttempts);

      try {
        const attemptStart = Date.now();
        const result = await fn();
        const latencyMs = Date.now() - attemptStart;
        this.concurrencyController?.recordSuccess(latencyMs);
        return {
          success: true,
          result,
          attempts,
          totalElapsedMs: Date.now() - startedAt,
        };
      } catch (raw) {
        const classification = this.classifier.classify(raw, url);
        const error = toScraperError(raw, url);
        const isLastAttempt = attempt >= this.maxAttempts;

        // Permanent failures — skip immediately regardless of attempt count
        if (
          (classification.verdict === 'skip' || classification.verdict === 'fatal') &&
          this.failFast
        ) {
          this.concurrencyController?.recordFailure();
          attempts.push({
            attempt,
            error,
            verdict: classification.verdict,
            delayMs: 0,
            totalElapsedMs: Date.now() - startedAt,
          });
          return { success: false, attempts, finalError: error, totalElapsedMs: Date.now() - startedAt };
        }

        if (isLastAttempt) {
          this.concurrencyController?.recordFailure();
          attempts.push({
            attempt,
            error,
            verdict: 'fatal',
            delayMs: 0,
            totalElapsedMs: Date.now() - startedAt,
          });
          return { success: false, attempts, finalError: error, totalElapsedMs: Date.now() - startedAt };
        }

        // Transient — schedule retry
        const delayMs = this.backoff.compute(attempt, classification.delayMs || undefined);
        const info: RetryAttempt = {
          attempt,
          error,
          verdict: classification.verdict,
          delayMs,
          totalElapsedMs: Date.now() - startedAt,
        };
        attempts.push(info);
        callbacks.onRetry?.(info);

        // Proxy rotation before sleeping
        if (classification.verdict === 'rotate-proxy') {
          this.concurrencyController?.recordFailure();
          await callbacks.onRotateProxy?.();
        }

        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }

    // Unreachable — satisfies TypeScript exhaustiveness
    const finalError = new FetchError(`Exceeded ${this.maxAttempts} attempts`, undefined, url);
    return { success: false, attempts, finalError, totalElapsedMs: Date.now() - startedAt };
  }
}

function toScraperError(err: unknown, url: string): ScraperError {
  if (err instanceof ScraperError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new FetchError(msg, undefined, url, err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
