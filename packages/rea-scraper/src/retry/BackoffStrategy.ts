/**
 * Exponential backoff with full jitter.
 *
 * Formula: min(maxDelayMs, random(0, baseDelayMs * 2^(attempt - 1)))
 *
 * "Full jitter" (sleep = random between 0 and cap) is recommended by AWS for
 * distributed systems because it spreads retry storms across time, unlike
 * "equal jitter" which still clusters retries.
 *
 * Reference: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class BackoffStrategy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: BackoffOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
  }

  /**
   * Compute the delay for a given attempt number (1-based).
   * The result already incorporates full jitter — call once and sleep for
   * exactly the returned value.
   *
   * @param attempt   1 = first retry, 2 = second retry, …
   * @param overrideMs  If set (e.g. from a Retry-After header), clamp-and-return it instead.
   */
  compute(attempt: number, overrideMs?: number): number {
    if (overrideMs !== undefined && overrideMs > 0) {
      // Still respect our own ceiling so a malicious server can't make us sleep forever
      return Math.min(overrideMs, this.maxDelayMs);
    }

    const expo = this.baseDelayMs * Math.pow(2, attempt - 1);
    const cap = Math.min(expo, this.maxDelayMs);
    return Math.floor(Math.random() * cap);
  }

  /** Async helper: compute delay and sleep. */
  async wait(attempt: number, overrideMs?: number): Promise<number> {
    const delay = this.compute(attempt, overrideMs);
    if (delay > 0) await sleep(delay);
    return delay;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
