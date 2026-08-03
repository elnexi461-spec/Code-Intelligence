import type { IRateLimiter } from "./types.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
  queue: Array<{ resolve: () => void }>;
}

export class RateLimiter implements IRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ratePerSecond: number;
  private readonly maxTokens: number;

  constructor(ratePerSecond = 10, maxTokens?: number) {
    this.ratePerSecond = ratePerSecond;
    this.maxTokens = maxTokens ?? ratePerSecond;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1_000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.ratePerSecond);
    bucket.lastRefill = now;
  }

  private getOrCreate(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) { bucket = { tokens: this.maxTokens, lastRefill: Date.now(), queue: [] }; this.buckets.set(key, bucket); }
    return bucket;
  }

  async acquire(key: string): Promise<void> {
    const bucket = this.getOrCreate(key);
    this.refill(bucket);
    if (bucket.tokens >= 1) { bucket.tokens -= 1; return; }
    return new Promise<void>((resolve) => { bucket.queue.push({ resolve }); this.scheduleRelease(key); });
  }

  release(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    this.refill(bucket);
    const next = bucket.queue.shift();
    if (next) { bucket.tokens = Math.max(0, bucket.tokens - 1); next.resolve(); }
  }

  private scheduleRelease(key: string): void {
    setTimeout(() => this.release(key), (1 / this.ratePerSecond) * 1_000);
  }

  cleanup(): void {
    for (const [key, bucket] of this.buckets) {
      this.refill(bucket);
      if (bucket.queue.length === 0 && bucket.tokens >= this.maxTokens) this.buckets.delete(key);
    }
  }
}
