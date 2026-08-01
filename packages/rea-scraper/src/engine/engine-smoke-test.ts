/**
 * End-to-end smoke test for the engine module.
 * Uses in-process mocks — no real HTTP, no real disk I/O.
 *
 * Verifies:
 *  1. Full pipeline: Queue → Fetch → Extract → Store → Complete
 *  2. Retry on transient failure (first attempt throws 503, second succeeds)
 *  3. Permanent skip (404 — job marked failed without retry)
 *  4. Graceful shutdown preserves queue state (pending jobs stay pending)
 */
import { QueueManager } from '../queue/QueueManager.js';
import { ScraperEngine } from './ScraperEngine.js';
import type { FetchResponse } from '../fetch/types.js';
import type { ExtractionResult } from '../extract/types.js';
import type { PropertyRecord } from '../extract/types.js';
import { FetchError, NotFoundError } from '../errors/error-types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(url: string): PropertyRecord {
  return {
    listingId: url,
    url,
    propertyType: 'house',
    address: { street: '1 Test St', suburb: 'Testville', state: 'NSW', postcode: '2000', full: '1 Test St, Testville NSW 2000' },
    price: { display: '$1,000,000' },
    features: { bedrooms: 3, bathrooms: 2, carSpaces: 1 },
    description: {},
    media: { images: [] },
    agent: {},
    location: {},
    metadata: { scrapedAt: new Date().toISOString() },
  } as unknown as PropertyRecord;
}

function makeFetchResponse(url: string): FetchResponse {
  return { url, statusCode: 200, body: '<html></html>', headers: {}, durationMs: 10, sessionId: 'test', fromCache: false };
}

// ── Test runner ───────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✓ ${msg}`); pass++; }
  else           { console.error(`  ✗ ${msg}`); fail++; }
}

async function run(): Promise<void> {
  // ── Test 1: happy path ─────────────────────────────────────────────────────
  console.log('\nTest 1: happy path (3 URLs → 3 records written)');
  {
    const stored: PropertyRecord[] = [];
    const queue = new QueueManager({ backend: 'memory' });
    await queue.enqueueBatch(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);

    const engine = new ScraperEngine(
      queue,
      { fetch: async (req: { url: string }) => makeFetchResponse(req.url) } as never,
      { extract: async (res: FetchResponse): Promise<ExtractionResult> => ({ record: makeRecord(res.url), strategy: 'next-data', confidence: 1 }) } as never,
      { write: async (r: PropertyRecord) => { stored.push(r); return { written: 1 }; }, flush: async () => {}, close: async () => {}, stats: { written: 0 }, getCheckpoint: () => undefined } as never,
      { pollIntervalMs: 50, shutdownTimeoutMs: 5_000 },
    );

    await engine.runUntilDone(500);
    const stats = engine.stats();

    assert(stored.length === 3, `3 records stored (got ${stored.length})`);
    assert(stats.processed === 3, `3 processed (got ${stats.processed})`);
    assert(stats.failed === 0, `0 failed`);
    assert(engine.currentState.is('stopped'), 'engine stopped after drain');
  }

  // ── Test 2: retry on transient failure ────────────────────────────────────
  console.log('\nTest 2: retry — first attempt 503, second succeeds');
  {
    const stored: PropertyRecord[] = [];
    const callCount: Record<string, number> = {};
    const queue = new QueueManager({ backend: 'memory' });
    await queue.enqueue('https://example.com/retry-me');

    const engine = new ScraperEngine(
      queue,
      {
        fetch: async (req: { url: string }) => {
          callCount[req.url] = (callCount[req.url] ?? 0) + 1;
          if (callCount[req.url]! < 2) throw new FetchError('Service Unavailable', 503, req.url);
          return makeFetchResponse(req.url);
        },
      } as never,
      { extract: async (res: FetchResponse): Promise<ExtractionResult> => ({ record: makeRecord(res.url), strategy: 'next-data', confidence: 1 }) } as never,
      { write: async (r: PropertyRecord) => { stored.push(r); return { written: 1 }; }, flush: async () => {}, close: async () => {}, stats: { written: 0 }, getCheckpoint: () => undefined } as never,
      { pollIntervalMs: 50, shutdownTimeoutMs: 5_000, baseDelayMs: 10, maxDelayMs: 50 },
    );

    await engine.runUntilDone(500);
    const stats = engine.stats();

    assert(stored.length === 1, `1 record stored after retry (got ${stored.length})`);
    assert(stats.processed === 1, `processed=1 (got ${stats.processed})`);
    assert(stats.totalRetries >= 1, `at least 1 retry recorded (got ${stats.totalRetries})`);
  }

  // ── Test 3: permanent failure (404) ───────────────────────────────────────
  console.log('\nTest 3: permanent skip — 404 not retried');
  {
    const callCount: Record<string, number> = {};
    const queue = new QueueManager({ backend: 'memory' });
    await queue.enqueue('https://example.com/gone');

    const engine = new ScraperEngine(
      queue,
      {
        fetch: async (req: { url: string }) => {
          callCount[req.url] = (callCount[req.url] ?? 0) + 1;
          throw new NotFoundError(req.url);
        },
      } as never,
      { extract: async () => { throw new Error('should not reach extract'); } } as never,
      { write: async () => { throw new Error('should not reach store'); }, flush: async () => {}, close: async () => {}, stats: { written: 0 }, getCheckpoint: () => undefined } as never,
      { pollIntervalMs: 50, shutdownTimeoutMs: 5_000 },
    );

    await engine.runUntilDone(500);

    assert(callCount['https://example.com/gone'] === 1, `fetcher called exactly once (got ${callCount['https://example.com/gone']})`);
  }

  // ── Test 4: graceful shutdown preserves pending jobs ──────────────────────
  console.log('\nTest 4: graceful shutdown — pending jobs stay in queue');
  {
    const queue = new QueueManager({ backend: 'memory' });
    await queue.enqueueBatch(['https://example.com/slow1', 'https://example.com/slow2', 'https://example.com/slow3']);

    const engine = new ScraperEngine(
      queue,
      {
        fetch: async (req: { url: string }) => {
          await new Promise(r => setTimeout(r, 200)); // slow fetch
          return makeFetchResponse(req.url);
        },
      } as never,
      { extract: async (res: FetchResponse): Promise<ExtractionResult> => ({ record: makeRecord(res.url), strategy: 'next-data', confidence: 1 }) } as never,
      { write: async () => ({ written: 1 }), flush: async () => {}, close: async () => {}, stats: { written: 0 }, getCheckpoint: () => undefined } as never,
      { pollIntervalMs: 50, shutdownTimeoutMs: 2_000, concurrency: 1 },
    );

    await engine.start();
    // Stop quickly — some jobs still pending
    await new Promise(r => setTimeout(r, 80));
    await engine.stop();
    const qStats = await queue.stats();

    assert(engine.currentState.is('stopped'), 'engine reached stopped state');
    // pending + active + completed should account for all 3 URLs
    const total = qStats.pending + qStats.active + qStats.completed + qStats.failed;
    assert(total === 3, `all 3 jobs accounted for in queue (got ${total})`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => { console.error('Smoke test crashed:', err); process.exit(1); });
