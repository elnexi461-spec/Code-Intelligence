/**
 * Classifies errors into retry verdicts without side-effects.
 *
 * Transient  → retry   (timeouts, network resets, 429, 5xx)
 * Proxy-fail → rotate-proxy  (bot-detected 403)
 * Permanent  → skip    (404, 410)
 * Unknown    → fatal   (config errors, storage errors, unexpected)
 */
import {
  ScraperError,
  FetchError,
  TimeoutError,
  RateLimitError,
  BotDetectedError,
  NotFoundError,
  GoneError,
  ProxyError,
} from '../errors/error-types.js';
import type { RetryVerdict } from './types.js';

export interface Classification {
  verdict: RetryVerdict;
  delayMs: number;
  /** Human-readable reason, used in logs. */
  reason: string;
}

/** HTTP status codes that are always transient. */
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 522, 524]);

/** Node.js network error codes that are always transient. */
const TRANSIENT_NETWORK_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'socket hang up',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
];

export class RetryClassifier {
  classify(err: unknown, url: string): Classification {
    // ── Permanent removals ─────────────────────────────────────────────
    if (err instanceof NotFoundError) {
      return { verdict: 'skip', delayMs: 0, reason: '404 Not Found' };
    }
    if (err instanceof GoneError) {
      return { verdict: 'skip', delayMs: 0, reason: '410 Gone' };
    }

    // ── Bot / proxy ────────────────────────────────────────────────────
    if (err instanceof BotDetectedError) {
      return { verdict: 'rotate-proxy', delayMs: 2_000, reason: 'Bot detected — rotating proxy' };
    }
    if (err instanceof ProxyError) {
      return { verdict: 'rotate-proxy', delayMs: 1_000, reason: 'Proxy failure — rotating' };
    }

    // ── Rate-limit: always retry with server-provided delay ────────────
    if (err instanceof RateLimitError) {
      return {
        verdict: 'retry',
        delayMs: err.retryAfterMs ?? 30_000,
        reason: `429 Rate limited (retry after ${err.retryAfterMs ?? 30_000}ms)`,
      };
    }

    // ── Timeout ────────────────────────────────────────────────────────
    if (err instanceof TimeoutError) {
      return { verdict: 'retry', delayMs: 1_000, reason: 'Request timeout' };
    }

    // ── ScraperError with HTTP status ──────────────────────────────────
    if (err instanceof ScraperError) {
      const code = err.statusCode;
      if (code) {
        if (TRANSIENT_STATUS_CODES.has(code)) {
          return { verdict: 'retry', delayMs: code === 429 ? 30_000 : 5_000, reason: `HTTP ${code}` };
        }
        if (code === 403) {
          return { verdict: 'rotate-proxy', delayMs: 2_000, reason: 'HTTP 403 — likely bot detection' };
        }
        if (code >= 400 && code < 500) {
          return { verdict: 'skip', delayMs: 0, reason: `HTTP ${code} — permanent client error` };
        }
      }
      // FetchError with no status → treat as network transient
      if (err instanceof FetchError && !code) {
        return { verdict: 'retry', delayMs: 2_000, reason: 'Fetch error (no status)' };
      }
      return { verdict: 'fatal', delayMs: 0, reason: `ScraperError(${err.code})` };
    }

    // ── Raw Node.js network errors ─────────────────────────────────────
    const msg = err instanceof Error ? err.message : String(err);
    if (TRANSIENT_NETWORK_CODES.some((p) => msg.includes(p))) {
      return { verdict: 'retry', delayMs: 1_000, reason: `Network error: ${msg.slice(0, 80)}` };
    }

    // ── Unknown — treat as fatal to avoid infinite loops ──────────────
    return { verdict: 'fatal', delayMs: 0, reason: `Unknown error: ${msg.slice(0, 80)}` };
  }
}
