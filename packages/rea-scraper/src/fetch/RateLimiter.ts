/**
 * Per-domain token bucket rate limiter.
 * Ensures we don't exceed requestsPerSecond per domain.
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();

  constructor(private readonly requestsPerSecond: number) {}

  async acquire(domain: string): Promise<void> {
    let bucket = this.buckets.get(domain);
    if (!bucket) {
      bucket = new TokenBucket(this.requestsPerSecond);
      this.buckets.set(domain, bucket);
    }
    return bucket.acquire();
  }

  setRate(domain: string, requestsPerSecond: number): void {
    const bucket = this.buckets.get(domain);
    if (bucket) {
      bucket.setRate(requestsPerSecond);
    } else {
      this.buckets.set(domain, new TokenBucket(requestsPerSecond));
    }
  }
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private intervalMs: number;

  constructor(private rps: number) {
    this.tokens = rps;
    this.lastRefill = Date.now();
    this.intervalMs = 1000 / rps;
  }

  setRate(rps: number): void {
    this.rps = rps;
    this.intervalMs = 1000 / rps;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    // Wait until next token is available
    const waitMs = this.intervalMs - (Date.now() - this.lastRefill);
    if (waitMs > 0) {
      await sleep(waitMs + Math.random() * 200); // add jitter
    }
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 1000) * this.rps;
    this.tokens = Math.min(this.rps, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
