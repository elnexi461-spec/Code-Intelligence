import type { PropertyRecord } from '../extract/types.js';
import type { StorageConfig, StorageWriter, WriteResult } from './types.js';
import { JsonlWriter } from './JsonlWriter.js';
import { CsvWriter } from './CsvWriter.js';
import { CheckpointManager } from './CheckpointManager.js';
import { FileManager } from './FileManager.js';
import { StorageError } from '../errors/error-types.js';
import { getLogger } from '../logger/Logger.js';

export class StorageEngine {
  private readonly writers: StorageWriter[] = [];
  private readonly checkpoint: CheckpointManager;
  private readonly fileMgr = new FileManager();
  private readonly log = getLogger();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: StorageConfig,
    private readonly jobId: string,
  ) {
    this.fileMgr.ensureDir(config.outputDir);
    this.checkpoint = new CheckpointManager(config.outputDir, jobId);

    for (const fmt of config.formats) {
      const writer = fmt === 'jsonl'
        ? new JsonlWriter(config, jobId)
        : new CsvWriter(config, jobId);
      this.writers.push(writer);
      this.checkpoint.addOutputFile(writer.currentFilePath);
    }

    // Periodic safety flush every 30s
    this.flushTimer = setInterval(() => {
      void this.flush().catch(err =>
        this.log.warn({ err }, 'periodic flush failed'),
      );
    }, 30_000);

    if (this.checkpoint.isResume) {
      this.log.info({
        jobId,
        totalWritten: this.checkpoint.totalWritten,
        lastUrl: this.checkpoint.lastUrl,
      }, 'resuming storage from checkpoint');
    }
  }

  async write(record: PropertyRecord): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    for (const writer of this.writers) {
      try {
        const r = await writer.write(record);
        results.push(r);
      } catch (err) {
        throw new StorageError(`Write failed for ${writer.currentFilePath}`, err);
      }
    }
    this.checkpoint.incrementWritten(record.url);
    return results;
  }

  async flush(): Promise<void> {
    await Promise.all(this.writers.map(w => w.flush()));
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await Promise.all(this.writers.map(w => w.close()));
    this.log.info({
      jobId: this.jobId,
      totalWritten: this.checkpoint.totalWritten,
      files: this.writers.map(w => w.currentFilePath),
    }, 'storage closed');
  }

  get stats() {
    return {
      totalWritten: this.checkpoint.totalWritten,
      bytesWritten: this.writers.reduce((s, w) => s + w.bytesWritten, 0),
      outputFiles: this.writers.map(w => w.currentFilePath),
      isResume: this.checkpoint.isResume,
    };
  }

  getCheckpoint(): ReturnType<CheckpointManager['get']> {
    return this.checkpoint.get();
  }
}
