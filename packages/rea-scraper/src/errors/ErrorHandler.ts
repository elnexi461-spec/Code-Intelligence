import {
  ScraperError,
  FetchError,
  RateLimitError,
  BotDetectedError,
  NotFoundError,
  GoneError,
} from './error-types.js';

export type ErrorDisposition = 'retry' | 'rotate-proxy' | 'skip' | 'fatal';

export interface ClassifiedError {
  disposition: ErrorDisposition;
  error: ScraperError;
  retryDelayMs?: number;
}

/**
 * Classifies HTTP status codes and error types into actionable dispositions.
 */
export class ErrorHandler {
  classify(err: unknown, url: string): ClassifiedError {
    if (err instanceof GoneError || err instanceof NotFoundError) {
      return { disposition: 'skip', error: err };
    }

    if (err instanceof BotDetectedError) {
      return { disposition: 'rotate-proxy', error: err };
    }

    if (err instanceof RateLimitError) {
      return {
        disposition: 'retry',
        error: err,
        retryDelayMs: err.retryAfterMs ?? 30_000,
      };
    }

    if (err instanceof ScraperError) {
      return this.classifyByStatusCode(err, url);
    }

    // Network-level errors (ECONNRESET, ETIMEDOUT, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    const networkPatterns = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'socket hang up'];
    if (networkPatterns.some(p => msg.includes(p))) {
      return {
        disposition: 'retry',
        error: new FetchError(`Network error: ${msg}`, undefined, url, err),
        retryDelayMs: 2_000,
      };
    }

    return {
      disposition: 'retry',
      error: new FetchError(`Unknown error: ${msg}`, undefined, url, err),
      retryDelayMs: 5_000,
    };
  }

  private classifyByStatusCode(err: ScraperError, url: string): ClassifiedError {
    const code = err.statusCode;
    if (!code) return { disposition: 'retry', error: err, retryDelayMs: 5_000 };

    if (code === 404) return { disposition: 'skip', error: new NotFoundError(url) };
    if (code === 410) return { disposition: 'skip', error: new GoneError(url) };
    if (code === 429) return { disposition: 'retry', error: err, retryDelayMs: 30_000 };
    if (code === 403) return { disposition: 'rotate-proxy', error: new BotDetectedError(url) };
    if (code >= 500) return { disposition: 'retry', error: err, retryDelayMs: 10_000 };

    return { disposition: 'fatal', error: err };
  }
}
