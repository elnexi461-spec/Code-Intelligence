/**
 * Stateless per-job pipeline: Fetch → Extract → Store.
 *
 * Accepts interface-typed dependencies so tests can inject mocks without
 * constructing the full concrete implementations.
 */
import type { QueueJob } from '../queue/types.js';
import type { FetchResponse } from '../fetch/types.js';
import type { PropertyRecord, ExtractionResult } from '../extract/types.js';
import type { PipelineResult } from './types.js';

export interface PipelineFetcher {
  fetch(req: { url: string }): Promise<FetchResponse>;
}

export interface PipelineExtractor {
  extract(response: FetchResponse): Promise<ExtractionResult>;
}

export interface PipelineStorage {
  write(record: PropertyRecord): Promise<unknown>;
}

export class Pipeline {
  constructor(
    private readonly fetcher: PipelineFetcher,
    private readonly extractor: PipelineExtractor,
    private readonly storage: PipelineStorage,
    private readonly timeoutMs: number = 60_000,
  ) {}

  async run(job: QueueJob): Promise<PipelineResult> {
    const start = Date.now();
    const abort = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Pipeline timeout after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      ),
    );

    // Re-throw so RetryManager can classify and decide whether to retry.
    const inner = await Promise.race([this._run(job), abort]);
    return { ...inner, durationMs: Date.now() - start };
  }

  private async _run(job: QueueJob): Promise<Omit<PipelineResult, 'durationMs'>> {
    // 1. Fetch
    const response = await this.fetcher.fetch({ url: job.url });

    // 2. Extract
    const extracted = await this.extractor.extract(response);

    // 3. Store
    await this.storage.write(extracted.record);

    return {
      jobId: job.id,
      url: job.url,
      success: true,
      record: extracted.record,
      strategy: extracted.strategy,
      attempts: [],
    };
  }
}
