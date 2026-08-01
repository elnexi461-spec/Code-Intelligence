import { createWriteStream, existsSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import type { PropertyRecord } from '../extract/types.js';
import type { StorageConfig, StorageWriter, WriteResult } from './types.js';
import { FileManager } from './FileManager.js';

// Ordered CSV columns — stable contract, add new fields at the end
const CSV_COLUMNS: (keyof PropertyRecord)[] = [
  'listingId', 'url', 'scrapedAt', 'extractionStrategy',
  'streetAddress', 'suburb', 'state', 'postcode',
  'latitude', 'longitude', 'propertyType',
  'bedrooms', 'bathrooms', 'carSpaces',
  'landSizeM2', 'buildingSizeM2', 'isNewDevelopment',
  'priceRaw', 'priceMin', 'priceMax', 'isAuction', 'auctionDate',
  'headline', 'description', 'propertyFeatures',
  'listedDate', 'imageUrls', 'floorplanUrls', 'hasVirtualTour',
  'agents',
];

function csvEscape(val: unknown): string {
  if (val === undefined || val === null) return '';
  const str = Array.isArray(val) || typeof val === 'object'
    ? JSON.stringify(val)
    : String(val);
  // Wrap in quotes if contains comma, newline, or quote
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export class CsvWriter implements StorageWriter {
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
      config.outputDir, prefix, `${jobId}_${suffix}`, 'csv',
    );
    this.fileMgr.ensureDirForFile(this.currentFilePath);

    const isNew = !existsSync(this.currentFilePath);
    this.stream = createWriteStream(this.currentFilePath, {
      encoding: 'utf-8',
      flags: 'a',
    });

    // Write header row only for new files
    if (isNew) {
      const header = CSV_COLUMNS.join(',') + '\n';
      this.stream.write(header, 'utf-8');
      this._bytesWritten += Buffer.byteLength(header, 'utf-8');
    }
  }

  async write(record: PropertyRecord): Promise<WriteResult> {
    const row = CSV_COLUMNS.map(col => csvEscape(record[col])).join(',') + '\n';
    const bytes = Buffer.byteLength(row, 'utf-8');

    await this.writeToStream(row);
    this._bytesWritten += bytes;
    this._recordsWritten++;
    this._pendingFlush++;

    if (this._pendingFlush >= this.config.flushEveryN) {
      await this.flush();
    }

    return { bytesWritten: bytes, filePath: this.currentFilePath };
  }

  async flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.stream.writable) return resolve();
      this.stream.once('drain', resolve);
      if (this.stream.write('')) resolve();
    }).then(() => { this._pendingFlush = 0; });
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
      if (!ok) this.stream.once('drain', resolve);
    });
  }
}
