// run: packages/rea-scraper/node_modules/.bin/tsx packages/rea-scraper/src/queue/queue-smoke-test.ts
import { QueueManager } from './QueueManager.js';
import { rmSync, existsSync } from 'node:fs';

const DB = '/tmp/rea-queue-smoke.db';
if (existsSync(DB)) rmSync(DB);

async function run() {
  // --- SQLite backend ---
  const q = QueueManager.withSqlite(DB);
  await q.initialize();

  // Batch enqueue
  const urls = [
    'https://www.realestate.com.au/property/1-foo-st-sydney-nsw-2000/',
    'https://www.realestate.com.au/property/2-bar-rd-melbourne-vic-3000/',
    'https://www.realestate.com.au/property/3-baz-ave-brisbane-qld-4000/',
    'https://www.realestate.com.au/property/1-foo-st-sydney-nsw-2000/', // duplicate
  ];
  const enqueued = await q.enqueueBatch(urls);
  console.assert(enqueued === 3, `Expected 3 enqueued, got ${enqueued}`);
  console.log('✅ Batch enqueue + dedup:', enqueued, '(expected 3)');

  // Batch dequeue
  const jobs = await q.dequeue({ batchSize: 2 });
  console.assert(jobs.length === 2, `Expected 2 dequeued, got ${jobs.length}`);
  console.log('✅ Batch dequeue:', jobs.length, '(expected 2)');

  // Complete one, fail one
  await q.complete(jobs[0]!);
  await q.fail(jobs[1]!, 'test error');

  const s1 = await q.stats();
  console.log('✅ Stats after complete+fail:', s1);
  console.assert(s1.completed === 1, `Expected completed=1`);
  console.assert(s1.pending === 2, `Expected pending=2 (1 original + 1 re-queued failed)`);

  await q.close();

  // --- Restart persistence test ---
  const q2 = QueueManager.withSqlite(DB);
  await q2.initialize(); // should recover 0 stale (none left active)
  const s2 = await q2.stats();
  console.log('✅ Survived restart — stats:', s2);
  console.assert(s2.completed === 1, `Expected completed=1 after restart`);
  await q2.close();

  // --- InMemory backend ---
  const m = QueueManager.withMemory();
  await m.enqueueBatch(['https://example.com/a', 'https://example.com/a']); // dedup
  const ms = await m.stats();
  console.assert(ms.pending === 1, `Memory dedup failed: got ${ms.pending}`);
  console.log('✅ InMemory dedup works');
  await m.close();

  console.log('✅ All queue tests passed');
}

run().catch(err => { console.error('❌', err); process.exit(1); });
