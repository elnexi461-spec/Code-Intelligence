/**
 * Adaptive concurrency controller using AIMD
 * (Additive Increase, Multiplicative Decrease).
 *
 * On success:  concurrency += addIncrease  (up to maxConcurrency)
 * On failure:  concurrency *= (1 - mulDecrease)  (down to minConcurrency)
 *
 * This mirrors TCP congestion control and self-tunes to the server's capacity
 * without manual configuration.
 */

export interface ConcurrencyControllerOptions {
  /** Starting concurrency. Default: 4. */
  initial?: number;
  /** Minimum concurrency (floor). Default: 1. */
  min?: number;
  /** Maximum concurrency (ceiling). Default: 50. */
  max?: number;
  /** How much to add per success. Default: 0.1 (fractional for smoothing). */
  addIncrease?: number;
  /** Multiplicative decrease factor on failure (0–1). Default: 0.5. */
  mulDecrease?: number;
}

export class ConcurrencyController {
  private _concurrency: number;
  private readonly min: number;
  private readonly max: number;
  private readonly addIncrease: number;
  private readonly mulDecrease: number;

  // Exponential moving average of latency (ms), used for observability
  private _avgLatencyMs = 0;
  private readonly latencyAlpha = 0.1; // EMA smoothing factor

  constructor(options: ConcurrencyControllerOptions = {}) {
    this.min = options.min ?? 1;
    this.max = options.max ?? 50;
    this._concurrency = Math.min(
      Math.max(options.initial ?? 4, this.min),
      this.max,
    );
    this.addIncrease = options.addIncrease ?? 0.1;
    this.mulDecrease = options.mulDecrease ?? 0.5;
  }

  /** Current recommended concurrency (rounded to nearest integer). */
  get concurrency(): number {
    return Math.round(this._concurrency);
  }

  /** Smoothed average latency in ms (EMA). */
  get avgLatencyMs(): number {
    return this._avgLatencyMs;
  }

  /**
   * Call after a successful request to gently increase concurrency.
   * @param latencyMs  Optional response latency in ms for EMA tracking.
   */
  recordSuccess(latencyMs?: number): void {
    this._concurrency = Math.min(this.max, this._concurrency + this.addIncrease);
    if (latencyMs !== undefined) {
      this._avgLatencyMs =
        this._avgLatencyMs === 0
          ? latencyMs
          : this._avgLatencyMs * (1 - this.latencyAlpha) + latencyMs * this.latencyAlpha;
    }
  }

  /**
   * Call after a failed/throttled request to back off concurrency.
   */
  recordFailure(): void {
    this._concurrency = Math.max(
      this.min,
      this._concurrency * (1 - this.mulDecrease),
    );
  }

  /**
   * Convenience: wrap an async operation, recording success/failure automatically.
   * Returns `{ result, latencyMs }`.
   */
  async run<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
    const start = Date.now();
    try {
      const result = await fn();
      const latencyMs = Date.now() - start;
      this.recordSuccess(latencyMs);
      return { result, latencyMs };
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** Snapshot of the current controller state for logging. */
  stats(): { concurrency: number; avgLatencyMs: number; min: number; max: number } {
    return {
      concurrency: this.concurrency,
      avgLatencyMs: Math.round(this._avgLatencyMs),
      min: this.min,
      max: this.max,
    };
  }
}
