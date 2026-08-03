import type { FetchRequest, FetchResponse } from './types.js';
import { HttpFetcher } from './HttpFetcher.js';
import { SessionManager } from './SessionManager.js';
import { TlsProfiler } from './TlsProfiler.js';
import { HeaderBuilder } from './HeaderBuilder.js';
import { ProxyManager } from './ProxyManager.js';
import { RateLimiter } from './RateLimiter.js';
import type { ScraperConfig } from '../config/types.js';
import { FetchError, RateLimitError, BotDetectedError } from '../errors/error-types.js';
import { getLogger } from '../logger/Logger.js';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function backoff(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(baseMs * 2 ** attempt, maxMs);
  return exp + Math.random() * 1000; // full jitter
}

export class FetchEngine {
  private readonly httpFetcher: HttpFetcher;
  private readonly rateLimiter: RateLimiter;
  private readonly log = getLogger();

  readonly sessions: SessionManager;
  readonly proxies: ProxyManager;

  constructor(private readonly config: ScraperConfig) {
    const tlsProfiler = new TlsProfiler();
    const headerBuilder = new HeaderBuilder();
    this.proxies = new ProxyManager(config.fetch.proxies);
    this.sessions = new SessionManager(config.fetch, tlsProfiler);
    this.httpFetcher = new HttpFetcher(this.sessions, tlsProfiler, headerBuilder, this.proxies);
    this.rateLimiter = new RateLimiter(config.fetch.requestsPerSecondPerDomain);
  }

  /**
   * Fetches a URL with automatic rate limiting, retry, and proxy rotation.
   */
  async fetch(req: FetchRequest): Promise<FetchResponse> {
    const domain = new URL(req.url).hostname;
    const { maxAttempts, baseDelayMs, maxDelayMs, retryableStatusCodes } = this.config.retry;

    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.rateLimiter.acquire(domain);
        return await this.httpFetcher.fetch(req);
      } catch (err: unknown) {
        lastErr = err;

        if (err instanceof RateLimitError) {
          const delay = err.retryAfterMs ?? backoff(attempt, baseDelayMs, maxDelayMs);
          this.log.warn({ url: req.url, attempt, delay }, 'rate limited, backing off');
          // Halve the rate for this domain after a 429
          this.rateLimiter.setRate(domain, this.config.fetch.requestsPerSecondPerDomain / 2);
          await sleep(delay);
          continue;
        }

        if (err instanceof BotDetectedError) {
          this.log.warn({ url: req.url, attempt }, 'bot detected, rotating session');
          // Force a new session next attempt — SessionManager already burned the old one
          req = { ...req, sessionId: undefined };
          await sleep(backoff(attempt, baseDelayMs * 2, maxDelayMs));
          continue;
        }

        if (err instanceof FetchError && err.statusCode !== undefined) {
          if (!retryableStatusCodes.includes(err.statusCode)) {
            throw err; // non-retryable status — propagate immediately
          }
        }

        if (attempt < maxAttempts - 1) {
          const delay = backoff(attempt, baseDelayMs, maxDelayMs);
          this.log.warn({ url: req.url, attempt, delay, err: (err as Error).message }, 'fetch failed, retrying');
          await sleep(delay);
        }
      }
    }

    throw lastErr ?? new FetchError(`Failed after ${maxAttempts} attempts`, undefined, req.url);
  }

  /**
   * Fetch with a known referer chain (simulates real navigation).
   */
  async fetchWithReferer(url: string, referer?: string): Promise<FetchResponse> {
    return this.fetch({ url, headers: referer ? { referer } : undefined });
  }
}
