export type ErrorCode =
  | 'FETCH_ERROR'
  | 'TIMEOUT_ERROR'
  | 'PARSE_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'BOT_DETECTED'
  | 'NOT_FOUND'
  | 'GONE'
  | 'AUTH_ERROR'
  | 'STORAGE_ERROR'
  | 'CONFIG_ERROR'
  | 'QUEUE_ERROR'
  | 'PROXY_ERROR';

export class ScraperError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

export class FetchError extends ScraperError {
  constructor(message: string, statusCode?: number, url?: string, cause?: unknown) {
    super('FETCH_ERROR', message, statusCode, url, cause);
    this.name = 'FetchError';
  }
}

export class TimeoutError extends ScraperError {
  constructor(url: string, timeoutMs: number) {
    super('TIMEOUT_ERROR', `Request timed out after ${timeoutMs}ms`, undefined, url);
    this.name = 'TimeoutError';
  }
}

export class RateLimitError extends ScraperError {
  constructor(url: string, retryAfterMs?: number) {
    super('RATE_LIMIT_ERROR', `Rate limited${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ''}`, 429, url);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
  retryAfterMs?: number;
}

export class BotDetectedError extends ScraperError {
  constructor(url: string, hint?: string) {
    super('BOT_DETECTED', `Bot detection triggered${hint ? `: ${hint}` : ''}`, 403, url);
    this.name = 'BotDetectedError';
  }
}

export class NotFoundError extends ScraperError {
  constructor(url: string) {
    super('NOT_FOUND', `Page not found`, 404, url);
    this.name = 'NotFoundError';
  }
}

export class GoneError extends ScraperError {
  constructor(url: string) {
    super('GONE', `Resource permanently removed`, 410, url);
    this.name = 'GoneError';
  }
}

export class ParseError extends ScraperError {
  constructor(message: string, url?: string, cause?: unknown) {
    super('PARSE_ERROR', message, undefined, url, cause);
    this.name = 'ParseError';
  }
}

export class ProxyError extends ScraperError {
  constructor(message: string, proxyUrl?: string, cause?: unknown) {
    super('PROXY_ERROR', message, undefined, proxyUrl, cause);
    this.name = 'ProxyError';
  }
}

export class StorageError extends ScraperError {
  constructor(message: string, cause?: unknown) {
    super('STORAGE_ERROR', message, undefined, undefined, cause);
    this.name = 'StorageError';
  }
}
