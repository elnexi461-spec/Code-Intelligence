/**
 * Per-domain circuit breaker (Closed → Open → Half-Open state machine).
 *
 * Closed:    All requests pass through; failures accumulate.
 * Open:      All requests rejected immediately; opens for `resetMs` ms.
 * Half-Open: One probe request is allowed; success closes, failure reopens.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures in the window before opening the circuit. Default: 5. */
  failureThreshold?: number;
  /** Time window (ms) over which failures are counted. Default: 60_000. */
  windowMs?: number;
  /** How long (ms) the circuit stays open before trying a probe. Default: 30_000. */
  resetMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;

  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly resetMs: number;

  // Sliding window of failure timestamps
  private readonly failureTimes: number[] = [];

  constructor(
    public readonly domain: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.resetMs = options.resetMs ?? 30_000;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Returns true if a request should be allowed through.
   * Throws when the circuit is open (caller should catch and treat as fast-fail).
   */
  allowRequest(): boolean {
    const now = Date.now();

    if (this.state === 'open') {
      if (now - this.openedAt >= this.resetMs) {
        this.state = 'half-open';
        this.probeInFlight = false;
      } else {
        return false;
      }
    }

    if (this.state === 'half-open') {
      if (this.probeInFlight) return false;
      this.probeInFlight = true;
      return true;
    }

    // Closed — prune stale failures
    this.pruneWindow(now);
    return true;
  }

  /** Record a successful request. */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.close();
    }
    // In closed state, success does not reset failure count — window naturally expires.
  }

  /** Record a failed request. */
  recordFailure(): void {
    const now = Date.now();

    if (this.state === 'half-open') {
      this.open(now);
      return;
    }

    if (this.state === 'open') return;

    // Closed state
    this.failureTimes.push(now);
    this.pruneWindow(now);
    this.failures = this.failureTimes.length;

    if (this.failures >= this.failureThreshold) {
      this.open(now);
    }
  }

  /** Run fn through the circuit breaker; records success/failure automatically. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.allowRequest()) {
      throw new Error(`Circuit open for domain: ${this.domain}`);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private open(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.probeInFlight = false;
  }

  private close(): void {
    this.state = 'closed';
    this.failures = 0;
    this.failureTimes.length = 0;
    this.probeInFlight = false;
  }

  private pruneWindow(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.failureTimes.length && this.failureTimes[i]! < cutoff) i++;
    if (i > 0) this.failureTimes.splice(0, i);
  }
}
