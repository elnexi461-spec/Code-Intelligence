import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import type { PropertyRecord } from '../extract/types.js';
import type { StorageConfig, StorageWriter, WriteResult } from './types.js';
import { FileManager } from './FileManager.js';

export class JsonlWriter implements StorageWriter {
  private stream: WriteStream;
  private _bytesWritten = 0;
  private _recordsWritten = 0;
  private _pendingFlush = 0;
  private readonly fileMgr = new FileManager();
  readonly currentFilePath: string;

  constructor(private readonly config: StorageConfig, jobId: string) {
    const suffix = new FileManager().buildTimestampSuffix();
    const prefix = config.filePrefix ?? 'properties';
    this.currentFilePath = this.fileMgr.buildFilePath(
      config.outputDir, prefix, `${jobId}_${suffix}`, 'jsonl',
    );
    this.fileMgr.ensureDirForFile(this.currentFilePath);
    this.stream = createWriteStream(this.currentFilePath, {
      encoding: 'utf-8',
      flags: 'a', // append — safe for resume
    });
  }

  async write(record: PropertyRecord): Promise<WriteResult> {
    const line = JSON.stringify(record) + '\n';
    const bytes = Buffer.byteLength(line, 'utf-8');

    await this.writeToStream(line);
    this._bytesWritten += bytes;
    this._recordsWritten++;
    this._pendingFlush++;

    if (this._pendingFlush >= this.config.flushEveryN) {
      await this.flush();
    }

    return { bytesWritten: bytes, filePath: this.currentFilePath };
  }

  async flush(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.stream.writable) return resolve();
      const ok = this.stream.write('');
      if (ok) resolve();
      else this.stream.once('drain', resolve);
    });
    this._pendingFlush = 0;
  }

  async close(): Promise<void> {
    await this.flush();
    return new Promise((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  get bytesWritten(): number { return this._bytesWritten; }
  get recordsWritten(): number { return this._recordsWritten; }

  private writeToStream(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ok = this.stream.write(data, 'utf-8', (err) => {
        if (err) reject(err); else if (ok) resolve();
      });
      if (!ok) {
        this.stream.once('drain', resolve);
      }
    });
  }
}
