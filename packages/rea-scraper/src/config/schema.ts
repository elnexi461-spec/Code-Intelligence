import { z } from 'zod';

const ProxyConfigSchema = z.object({
  url: z.string().url(),
  protocol: z.enum(['http', 'socks5']),
});

const FetchConfigSchema = z.object({
  concurrency: z.number().int().min(1).max(1000),
  requestsPerSecondPerDomain: z.number().positive(),
  requestTimeoutMs: z.number().int().positive(),
  connectTimeoutMs: z.number().int().positive(),
  sessionWarmupEnabled: z.boolean(),
  maxConnectionsPerOrigin: z.number().int().min(1),
  keepAliveTimeoutMs: z.number().int().positive(),
  userAgents: z.array(z.string().min(10)).min(1),
  proxies: z.array(ProxyConfigSchema),
});

const RetryConfigSchema = z.object({
  maxAttempts: z.number().int().min(0).max(20),
  baseDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
  retryableStatusCodes: z.array(z.number().int()),
});

const QueueConfigSchema = z.object({
  backend: z.enum(['memory', 'sqlite']),
  dbPath: z.string(),
  batchSize: z.number().int().min(1),
  maxQueueSize: z.number().int().positive(),
});

const StorageConfigSchema = z.object({
  backends: z.array(z.enum(['jsonl', 'csv', 'sqlite'])).min(1),
  outputDir: z.string(),
  flushEveryN: z.number().int().positive(),
  maxFileSizeBytes: z.number().int().positive(),
});

const ParserConfigSchema = z.object({
  strategyOrder: z.array(z.enum(['next-data', 'graphql', 'html', 'playwright'])).min(1),
  enableSchemaValidation: z.boolean(),
  minFieldsRequired: z.number().int().min(1),
});

const LogConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']),
  format: z.enum(['pretty', 'json']),
  file: z.string().optional(),
});

const MetricsConfigSchema = z.object({
  snapshotIntervalMs: z.number().int().positive(),
  enabled: z.boolean(),
});

export const ScraperConfigSchema = z.object({
  fetch: FetchConfigSchema,
  retry: RetryConfigSchema,
  queue: QueueConfigSchema,
  storage: StorageConfigSchema,
  parser: ParserConfigSchema,
  log: LogConfigSchema,
  metrics: MetricsConfigSchema,
});
