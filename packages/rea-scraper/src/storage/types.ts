import type { PropertyRecord } from '../extract/types.js';

export type OutputFormat = 'jsonl' | 'csv';

export interface StorageConfig {
  outputDir: string;
  formats: OutputFormat[];
  filePrefix?: string;
  flushEveryN: number;
  maxFileSizeBytes: number;
}

export interface WriteResult {
  bytesWritten: number;
  filePath: string;
}

export interface CheckpointData {
  jobId: string;
  startedAt: string;
  updatedAt: string;
  totalWritten: number;
  lastUrl?: string;
  outputFiles: string[];
  metadata?: Record<string, unknown>;
}

export interface StorageWriter {
  write(record: PropertyRecord): Promise<WriteResult>;
  flush(): Promise<void>;
  close(): Promise<void>;
  readonly bytesWritten: number;
  readonly recordsWritten: number;
  readonly currentFilePath: string;
}
