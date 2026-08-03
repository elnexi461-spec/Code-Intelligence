export interface ProxyConfig {
  url: string; // e.g. http://user:pass@host:port
  protocol: 'http' | 'socks5';
}

export type ExtractionStrategy = 'next-data' | 'graphql' | 'html' | 'playwright';
export type QueueBackend = 'memory' | 'sqlite';
export type StorageBackend = 'jsonl' | 'csv' | 'sqlite';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'pretty' | 'json';

export interface FetchConfig {
  concurrency: number;
  requestsPerSecondPerDomain: number;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  sessionWarmupEnabled: boolean;
  maxConnectionsPerOrigin: number;
  keepAliveTimeoutMs: number;
  userAgents: string[];
  proxies: ProxyConfig[];
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

export interface QueueConfig {
  backend: QueueBackend;
  dbPath: string;
  batchSize: number;
  maxQueueSize: number;
}

export interface StorageConfig {
  backends: StorageBackend[];
  outputDir: string;
  flushEveryN: number;
  maxFileSizeBytes: number;
}

export interface ParserConfig {
  strategyOrder: ExtractionStrategy[];
  enableSchemaValidation: boolean;
  minFieldsRequired: number;
}

export interface LogConfig {
  level: LogLevel;
  format: LogFormat;
  file?: string;
}

export interface MetricsConfig {
  snapshotIntervalMs: number;
  enabled: boolean;
}

export interface ScraperConfig {
  fetch: FetchConfig;
  retry: RetryConfig;
  queue: QueueConfig;
  storage: StorageConfig;
  parser: ParserConfig;
  log: LogConfig;
  metrics: MetricsConfig;
}
