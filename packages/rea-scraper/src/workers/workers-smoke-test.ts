// run: packages/rea-scraper/node_modules/.bin/tsx packages/rea-scraper/src/workers/workers-smoke-test.ts
import { WorkerManager } from './WorkerManager.js';
import { QueueManager } from '../queue/QueueManager.js';
import { ExtractionEngine } from '../extract/ExtractionEngine.js';
import { StorageEngine } from '../storage/StorageEngine.js';
import type { FetchEngine } from '../fetch/FetchEngine.js';
import type { FetchRequest, FetchResponse } from '../fetch/types.js';
import { rmSync, existsSync } from 'node:fs';

// ── Mock FetchEngine ─────────────────────────────────────────────────────────
function makeMockFetcher(urlMap: Map<string, number>): FetchEngine {
  return {
    fetch: async (req: FetchRequest): Promise<FetchResponse> => {
      const idx = urlMap.get(req.url) ?? 0;
      const nextData = JSON.stringify({
        props: {
          pageProps: {
            listing: {
              id: `listing-${idx}`,
              address: { streetNumber: String(idx), street: 'Test St', suburb: 'Sydney', state: 'NSW', postcode: '2000', location: { lat: -33.87, long: 151.21 } },
              price: { display: `$${500_000 + idx * 1000}` },
              generalFeatures: { bedrooms: { value: 3 }, bathrooms: { value: 2 }, parkingSpaces: { value: 1 } },
              propertyType: 'House',
              headline: `Property ${idx}`,
              description: `Description for property ${idx}`,
              agents: [{ name: 'Test Agent', phone: '0400000000', agency: { name: 'Test Agency', id: '1' } }],
              media: { images: [{ url: `https://img.example.com/${idx}.jpg` }] },
            },
          },
        },
      });
      const body = `<!DOCTYPE html><html><head></head><body><script id="__NEXT_DATA__" type="application/json">${nextData}</script></body></html>`;
      return { url: req.url, statusCode: 200, headers: {}, body, durationMs: 5, sessionId: 'mock', fromCache: false };
    },
  } as unknown as FetchEngine;
}

// ── Setup ────────────────────────────────────────────────────────────────────
const OUT = '/tmp/rea-workers-smoke';
const DB  = '/tmp/rea-workers-smoke-queue.db';
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
if (existsSync(DB))  rmSync(DB);

const TOTAL = 100;
const urls = Array.from({ length: TOTAL }, (_, i) =>
  `https://www.realestate.com.au/property/${i}-mock-st-sydney-nsw-2000/`,
);
const urlMap = new Map(urls.map((u, i) => [u, i]));

async function run() {
  const queue   = QueueManager.withSqlite(DB);
  const storage = new StorageEngine({ outputDir: OUT, formats: ['jsonl'], flushEveryN: 10, maxFileSizeBytes: 50_000_000 }, 'smoke-workers');
  const extractor = new ExtractionEngine();
  const fetcher   = makeMockFetcher(urlMap);

  // Enqueue 100 URLs (+ 10 duplicates that must be silently ignored)
  const dupes = urls.slice(0, 10);
  const enqueued = await queue.enqueueBatch([...urls, ...dupes]);
  console.assert(enqueued === TOTAL, `Expected ${TOTAL} enqueued, got ${enqueued}`);
  console.log(`✅ Enqueued: ${enqueued} (10 dupes ignored)`);

  const mgr = new WorkerManager(queue, fetcher, extractor, storage, {
    concurrency: 10,
    jobTimeoutMs: 10_000,
    pollIntervalMs: 50,
    healthCheckIntervalMs: 999_999, // suppress health log noise
  });

  let completed = 0;
  let failed = 0;
  mgr.onResult(r => { if (r.success) completed++; else failed++; });

  const t0 = Date.now();
  await mgr.runUntilDone(100);
  const elapsed = Date.now() - t0;

  const stats = await mgr.fullStats();
  console.log(`✅ Jobs completed: ${completed}  failed: ${failed}  elapsed: ${elapsed}ms`);
  console.log(`✅ Pool stats:`, stats.pool);
  console.log(`✅ Queue stats:`, stats.queue);

  console.assert(completed === TOTAL, `Expected ${TOTAL} completed, got ${completed}`);
  console.assert(failed === 0, `Expected 0 failed, got ${failed}`);
  console.assert(stats.queue.completed === TOTAL, `Queue completed mismatch`);

  await storage.close();
  await queue.close();

  // ── Graceful shutdown / queue persistence check ──
  const q2 = QueueManager.withSqlite(DB);
  const s2 = await q2.stats();
  console.assert(s2.completed === TOTAL, `Queue state not preserved after restart: ${JSON.stringify(s2)}`);
  console.log(`✅ Queue state preserved after shutdown (completed=${s2.completed})`);
  await q2.close();

  console.log(`✅ All worker pool tests passed (${completed}/${TOTAL} jobs, ${(TOTAL / (elapsed / 60_000)).toFixed(0)} jobs/min)`);
}

run().catch(err => { console.error('❌', err); process.exit(1); });
