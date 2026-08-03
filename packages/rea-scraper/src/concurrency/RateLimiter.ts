/**
 * Token-bucket rate limiter, keyed per domain.
 *
 * Each domain gets its own bucket. Tokens refill continuously at `ratePerSec`
 * tokens/second up to `burst`. `consume()` waits until a token is available.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
  readonly queue: Array<() => void>;
}

export interface RateLimiterOptions {
  /** Sustained requests/second per domain. Default: 2. */
  ratePerSec?: number;
  /** Burst capacity (max tokens per bucket). Default: 5. */
  burst?: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ratePerSec: number;
  private readonly burst: number;

  constructor(options: RateLimiterOptions = {}) {
    this.ratePerSec = options.ratePerSec ?? 2;
    this.burst = options.burst ?? 5;
  }

  /**
   * Wait until a token is available for `domain`, then consume it.
   * Returns the delay waited in milliseconds.
   */
  async consume(domain: string): Promise<number> {
    const bucket = this.getOrCreate(domain);
    const start = Date.now();

    return new Promise<number>((resolve) => {
      const attempt = (): void => {
        this.refill(bucket);
        if (bucket.tokens >= 1) {
          bucket.tokens -= 1;
          resolve(Date.now() - start);
        } else {
          // Schedule retry after the time needed to earn 1 token
          const waitMs = Math.ceil((1 - bucket.tokens) / this.ratePerSec * 1000);
          bucket.queue.push(attempt);
          setTimeout(() => {
            const next = bucket.queue.shift();
            if (next) next();
          }, waitMs);
        }
      };
      attempt();
    });
  }

  /** Returns current token count for a domain (for observability). */
  tokens(domain: string): number {
    const bucket = this.buckets.get(domain);
    if (!bucket) return this.burst;
    this.refill(bucket);
    return bucket.tokens;
  }

  private getOrCreate(domain: string): Bucket {
    let bucket = this.buckets.get(domain);
    if (!bucket) {
      bucket = { tokens: this.burst, lastRefill: Date.now(), queue: [] };
      this.buckets.set(domain, bucket);
    }
    return bucket;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.ratePerSec);
    bucket.lastRefill = now;
  }
}
