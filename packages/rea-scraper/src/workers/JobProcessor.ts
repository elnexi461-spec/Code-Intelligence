import type { QueueJob } from '../queue/types.js';
import type { FetchEngine } from '../fetch/FetchEngine.js';
import type { ExtractionEngine } from '../extract/ExtractionEngine.js';
import type { StorageEngine } from '../storage/StorageEngine.js';
import type { ProcessResult } from './types.js';
import { getLogger } from '../logger/Logger.js';

export class JobProcessor {
  private readonly log = getLogger();

  constructor(
    private readonly fetcher: FetchEngine,
    private readonly extractor: ExtractionEngine,
    private readonly storage: StorageEngine,
    private readonly jobTimeoutMs: number = 60_000,
  ) {}

  async process(job: QueueJob): Promise<ProcessResult> {
    const start = Date.now();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Job timed out after ${this.jobTimeoutMs}ms`)), this.jobTimeoutMs),
    );

    try {
      const result = await Promise.race([this.run(job), timeout]);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn({ jobId: job.id, url: job.url, err: msg }, 'job processor failed');
      return { jobId: job.id, url: job.url, success: false, durationMs: Date.now() - start, error: msg };
    }
  }

  private async run(job: QueueJob): Promise<ProcessResult> {
    const start = Date.now();

    // 1. Fetch
    const response = await this.fetcher.fetch({ url: job.url });

    // 2. Extract
    const extracted = await this.extractor.extract(response);

    // 3. Store
    await this.storage.write(extracted.record);

    const durationMs = Date.now() - start;
    this.log.debug({ jobId: job.id, url: job.url, strategy: extracted.strategy, durationMs }, 'job processed');

    return { jobId: job.id, url: job.url, success: true, durationMs, strategy: extracted.strategy };
  }
}
