/**
 * Async counting semaphore — limits the number of concurrent operations.
 *
 * Usage:
 *   const sem = new Semaphore(5);
 *   const release = await sem.acquire();
 *   try { ... } finally { release(); }
 */
export class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new RangeError('Semaphore max must be >= 1');
    this.count = max;
  }

  /** Current number of available permits. */
  get available(): number {
    return this.count;
  }

  /** Number of callers waiting for a permit. */
  get waiting(): number {
    return this.queue.length;
  }

  /** Acquire one permit, waiting if none are available. Returns a release function. */
  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve(() => this.release());
      } else {
        this.queue.push(() => {
          this.count--;
          resolve(() => this.release());
        });
      }
    });
  }

  /** Run fn inside the semaphore, automatically releasing on completion. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Execute next waiter synchronously in microtask to preserve ordering
      next();
    } else {
      this.count++;
    }
  }
}
