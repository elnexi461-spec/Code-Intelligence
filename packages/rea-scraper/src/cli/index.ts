#!/usr/bin/env node
/**
 * REA Scraper CLI
 * Usage: tsx src/cli/index.ts <command> [options]
 *
 * Commands:
 *   scrape   <urls...>   Scrape property URLs
 *   status               Show queue status
 *   benchmark            Run a quick benchmark
 *   config               Print resolved config
 *   version              Print version
 *   help                 Show usage
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigManager } from '../config/ConfigManager.js';
import { QueueManager } from '../queue/QueueManager.js';
import { FetchEngine } from '../fetch/FetchEngine.js';
import { ExtractionEngine } from '../extract/ExtractionEngine.js';
import { StorageEngine } from '../storage/StorageEngine.js';
import { ScraperEngine } from '../engine/ScraperEngine.js';
import type { StorageConfig } from '../storage/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pkgVersion(): string {
  try {
    const p = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };
    return p.version;
  } catch {
    return '0.0.1';
  }
}

// Flags that never take a value argument
const BOOL_FLAGS = new Set(['resume', 'dry-run', 'help', 'verbose']);

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const name = a.slice(2);
        const next = args[i + 1];
        if (!BOOL_FLAGS.has(name) && next && !next.startsWith('--') && !next.startsWith('http')) {
          flags[name] = args[++i]!;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function buildStorageConfig(cfg: ReturnType<ConfigManager['get']>, outputDir?: string): StorageConfig {
  return {
    formats: (cfg.storage.backends as string[]).filter(b => b === 'jsonl' || b === 'csv') as StorageConfig['formats'],
    outputDir: outputDir ?? cfg.storage.outputDir,
    flushEveryN: cfg.storage.flushEveryN,
    maxFileSizeBytes: cfg.storage.maxFileSizeBytes,
  };
}

function printHelp(): void {
  console.log(`
rea-scraper v${pkgVersion()}

USAGE
  scrape   [--config <path>] [--output <dir>] [--concurrency <n>] [--resume] <url> [url...]
  status   [--config <path>] [--db <path>]
  benchmark [--urls <n>] [--config <path>]
  config   [--config <path>]
  version
  help

OPTIONS (scrape)
  --config  <path>   Config YAML file (default: none)
  --output  <dir>    Output directory  (default: ./output)
  --concurrency <n>  Parallel workers  (default: config value)
  --db <path>        SQLite queue path (default: .rea-scraper/queue.db)
  --resume           Resume from existing queue (do not re-enqueue)
  --dry-run          Print resolved config and exit
`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdScrape(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);

  if (flags['help']) { printHelp(); return; }

  const configPath = typeof flags['config'] === 'string' ? resolve(flags['config']) : undefined;
  const outputDir  = typeof flags['output'] === 'string' ? resolve(flags['output']) : undefined;
  const concurrency = typeof flags['concurrency'] === 'string' ? parseInt(flags['concurrency']) : undefined;
  const dbPath     = typeof flags['db'] === 'string' ? flags['db'] : '.rea-scraper/queue.db';
  const resume     = flags['resume'] === true;
  const dryRun     = flags['dry-run'] === true;

  const cfgMgr = new ConfigManager(configPath, concurrency ? { fetch: { concurrency } as never } : undefined);
  const cfg = cfgMgr.get();

  if (dryRun) {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }

  const urls = positional;
  if (urls.length === 0 && !resume) {
    console.error('Error: provide at least one URL, or use --resume to continue an existing queue.');
    process.exit(1);
  }

  const queue = new QueueManager({ backend: 'sqlite', dbPath });
  if (!resume && urls.length > 0) {
    await queue.enqueueBatch(urls);
    console.log(`Enqueued ${urls.length} URL(s).`);
  } else {
    console.log('Resuming from existing queue…');
  }

  const storageCfg = buildStorageConfig(cfg, outputDir);
  const jobId = `cli-${Date.now()}`;
  const storage = new StorageEngine(storageCfg, jobId);

  const engine = new ScraperEngine(
    queue,
    new FetchEngine(cfg),
    new ExtractionEngine(),
    storage,
    {
      concurrency: concurrency ?? cfg.fetch.concurrency,
      maxAttempts: cfg.retry.maxAttempts,
      baseDelayMs: cfg.retry.baseDelayMs,
      maxDelayMs:  cfg.retry.maxDelayMs,
      pollIntervalMs: 200,
    },
    {
      onJobComplete: (r) => console.log(`✓ ${r.url} [${r.strategy ?? '?'}, ${r.durationMs}ms]`),
      onJobFail:     (r) => console.error(`✗ ${r.url}: ${r.error}`),
      onRetry:       (a, j) => console.warn(`↺ ${j.url} attempt ${a.attempt} (${a.verdict}, wait ${a.delayMs}ms)`),
      onShutdown:    (s) => console.log(`\nDone — processed:${s.processed} failed:${s.failed} skipped:${s.skipped} (${Math.round(s.uptimeMs / 1000)}s)`),
    },
  );

  // Graceful SIGINT / SIGTERM
  const shutdown = (): void => { void engine.stop(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await engine.runUntilDone();
  await storage.close();
}

async function cmdStatus(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const dbPath = typeof flags['db'] === 'string' ? flags['db'] : '.rea-scraper/queue.db';
  const queue = new QueueManager({ backend: 'sqlite', dbPath });
  const stats = await queue.stats();
  console.log(JSON.stringify(stats, null, 2));
  await queue.close();
}

async function cmdBenchmark(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const n = typeof flags['urls'] === 'string' ? parseInt(flags['urls']) : 5;
  const configPath = typeof flags['config'] === 'string' ? resolve(flags['config']) : undefined;
  const cfgMgr = new ConfigManager(configPath);
  const cfg = cfgMgr.get();

  // Generate synthetic benchmark URLs (no real HTTP — measures pipeline overhead)
  const urls = Array.from({ length: n }, (_, i) => `https://www.realestate.com.au/property/house-${i + 1}`);
  const queue = new QueueManager({ backend: 'memory' });
  await queue.enqueueBatch(urls);

  const results: Array<{ durationMs: number }> = [];
  const storageCfg = buildStorageConfig(cfg, '/tmp/rea-benchmark');
  const storage = new StorageEngine(storageCfg, `bench-${Date.now()}`);

  const engine = new ScraperEngine(
    queue,
    new FetchEngine(cfg),
    new ExtractionEngine(),
    storage,
    { concurrency: Math.min(n, 4), pollIntervalMs: 50 },
    { onJobComplete: (r) => results.push({ durationMs: r.durationMs }) },
  );

  const start = Date.now();
  await engine.runUntilDone(500);
  await storage.close();

  const elapsed = Date.now() - start;
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length) : 0;
  console.log(`Benchmark: ${results.length}/${n} completed in ${elapsed}ms (avg ${avg}ms/job)`);
}

function cmdConfig(args: string[]): void {
  const { flags } = parseFlags(args);
  const configPath = typeof flags['config'] === 'string' ? resolve(flags['config']) : undefined;
  const cfgMgr = new ConfigManager(configPath);
  console.log(JSON.stringify(cfgMgr.get(), null, 2));
}

function cmdVersion(): void {
  console.log(`rea-scraper v${pkgVersion()}`);
}

// ── Entry ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [,, command, ...rest] = process.argv;

  switch (command) {
    case 'scrape':    await cmdScrape(rest); break;
    case 'status':    await cmdStatus(rest); break;
    case 'benchmark': await cmdBenchmark(rest); break;
    case 'config':    cmdConfig(rest); break;
    case 'version':   cmdVersion(); break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:   printHelp(); break;
    default:
      console.error(`Unknown command: ${command}\nRun "rea-scraper help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
