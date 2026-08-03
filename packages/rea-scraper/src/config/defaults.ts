import type { ScraperConfig } from './types.js';

// Real Chrome 124 user agents - weighted by market share
const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

export const DEFAULT_CONFIG: ScraperConfig = {
  fetch: {
    concurrency: 50,
    requestsPerSecondPerDomain: 2,
    requestTimeoutMs: 30_000,
    connectTimeoutMs: 10_000,
    sessionWarmupEnabled: false,
    maxConnectionsPerOrigin: 10,
    keepAliveTimeoutMs: 60_000,
    userAgents: DEFAULT_USER_AGENTS,
    proxies: [],
  },
  retry: {
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  },
  queue: {
    backend: 'memory',
    dbPath: '.rea-scraper/queue.db',
    batchSize: 20,
    maxQueueSize: 10_000_000,
  },
  storage: {
    backends: ['jsonl'],
    outputDir: './output',
    flushEveryN: 100,
    maxFileSizeBytes: 256 * 1024 * 1024, // 256 MB
  },
  parser: {
    strategyOrder: ['next-data', 'graphql', 'html', 'playwright'],
    enableSchemaValidation: false,
    minFieldsRequired: 3,
  },
  log: {
    level: 'info',
    format: 'pretty',
  },
  metrics: {
    snapshotIntervalMs: 10_000,
    enabled: true,
  },
};
