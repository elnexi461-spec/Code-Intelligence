import type { Readable } from "node:stream";

// ─── Core request/response types ────────────────────────────────────────────

export interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Readable;
  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  stream?: boolean;
  sessionId?: string;
  /** Extra metadata forwarded to hooks */
  meta?: Record<string, unknown>;
}

export interface FetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  stream?: Readable;
  metrics: RequestMetrics;
  ok: boolean;
  /** True when the response indicates a Cloudflare challenge/block */
  cloudflareBlocked: boolean;
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export interface RequestMetrics {
  startedAt: number;
  ttfbMs: number | null;
  totalMs: number;
  bytesReceived: number;
  bytesSent: number;
  redirectCount: number;
  retryCount: number;
  fromCache: boolean;
  httpVersion: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export type RetryDecision =
  | { retry: false }
  | { retry: true; delayMs: number };

export type ProxyUrl = string | null;

export type OnRetryHook = (
  req: FetchRequest,
  res: FetchResponse | null,
  err: Error | null,
  attempt: number
) => RetryDecision | Promise<RetryDecision>;

export type OnProxyHook = (
  req: FetchRequest
) => ProxyUrl | Promise<ProxyUrl>;

export type OnRequestHook = (
  req: FetchRequest
) => FetchRequest | Promise<FetchRequest>;

export type OnResponseHook = (
  req: FetchRequest,
  res: FetchResponse
) => FetchResponse | Promise<FetchResponse>;

// ─── Config ─────────────────────────────────────────────────────────────────

export interface FetchEngineConfig {
  baseUrl?: string;
  defaultTimeoutMs?: number;
  maxConnectionsPerOrigin?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  decompress?: boolean;
  keepAlive?: boolean;
  keepAliveTimeoutMs?: number;
  http2?: boolean;
  defaultHeaders?: Record<string, string>;
  onRetry?: OnRetryHook;
  onProxy?: OnProxyHook;
  onRequest?: OnRequestHook;
  onResponse?: OnResponseHook;
  rateLimiter?: IRateLimiter;
  sessionManager?: ISessionManager;
}

// ─── Integration interfaces ─────────────────────────────────────────────────

export interface IRateLimiter {
  acquire(key: string): Promise<void>;
  release(key: string): void;
}

export interface ISessionManager {
  getUserAgent(sessionId?: string): string;
  getCookies(url: string, sessionId?: string): string;
  setCookies(url: string, setCookieHeaders: string[], sessionId?: string): void;
  destroySession(sessionId: string): void;
}

export interface ILogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface IConfigManager {
  get<T>(key: string, defaultValue?: T): T;
  getAll(): Record<string, unknown>;
}
