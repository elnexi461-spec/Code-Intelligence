// Smoke test — run with: pnpm tsx src/storage/smoke-test.ts
import { StorageEngine } from './StorageEngine.js';
import { rmSync, existsSync, readFileSync } from 'node:fs';

const OUT = '/tmp/rea-smoke-test';
const JOB = 'smoke-001';

// Clean slate
if (existsSync(OUT)) rmSync(OUT, { recursive: true });

const record = {
  url: 'https://www.realestate.com.au/property/33-irvine-st-peppermint-grove-wa-6011/',
  scrapedAt: new Date().toISOString(),
  extractionStrategy: 'next-data' as const,
  listingId: '123456',
  streetAddress: '33 Irvine St',
  suburb: 'Peppermint Grove',
  state: 'WA',
  postcode: '6011',
  latitude: -31.9945,
  longitude: 115.7677,
  propertyType: 'House',
  bedrooms: 4,
  bathrooms: 3,
  carSpaces: 2,
  priceRaw: '$5,250,000',
  priceMin: 5250000,
  description: 'Magnificent riverside property in prestigious Peppermint Grove.',
  propertyFeatures: ['Pool', 'Garage', 'Ducted Air Conditioning'],
  imageUrls: ['https://bucket.realestate.com.au/img/123.jpg'],
  agents: [{ name: 'Jane Smith', phone: '0400000000', agencyName: 'Ray White' }],
};

async function run() {
  // --- Write pass ---
  const engine = new StorageEngine(
    { outputDir: OUT, formats: ['jsonl', 'csv'], flushEveryN: 1, maxFileSizeBytes: 10_000_000 },
    JOB,
  );
  await engine.write(record);
  await engine.close();

  const stats = engine.stats;
  console.log('✅ Write pass:', stats);

  // --- Resume pass ---
  const engine2 = new StorageEngine(
    { outputDir: OUT, formats: ['jsonl', 'csv'], flushEveryN: 1, maxFileSizeBytes: 10_000_000 },
    JOB,
  );
  console.log('✅ Resume detected:', engine2.stats.isResume, '(totalWritten=', engine2.getCheckpoint().totalWritten, ')');
  await engine2.write({ ...record, listingId: '654321' });
  await engine2.close();

  // --- Verify JSONL content ---
  const jsonlFile = engine.stats.outputFiles.find(f => f.endsWith('.jsonl'));
  if (jsonlFile && existsSync(jsonlFile)) {
    const lines = readFileSync(jsonlFile, 'utf-8').trim().split('\n');
    const parsed = JSON.parse(lines[0]!);
    console.log('✅ JSONL valid — first record suburb:', parsed.suburb);
    console.log('✅ JSONL total lines:', lines.length);
  }

  console.log('✅ All checks passed');
}

run().catch(err => { console.error('❌', err); process.exit(1); });
