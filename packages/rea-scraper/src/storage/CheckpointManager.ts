import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckpointData } from './types.js';
import { FileManager } from './FileManager.js';

export class CheckpointManager {
  private readonly fileMgr = new FileManager();
  private readonly checkpointPath: string;
  private data: CheckpointData;

  constructor(outputDir: string, jobId: string) {
    this.checkpointPath = join(outputDir, '.checkpoints', `${jobId}.json`);
    this.fileMgr.ensureDirForFile(this.checkpointPath);
    this.data = this.load(jobId);
  }

  private load(jobId: string): CheckpointData {
    if (existsSync(this.checkpointPath)) {
      try {
        return JSON.parse(readFileSync(this.checkpointPath, 'utf-8')) as CheckpointData;
      } catch {
        // corrupted checkpoint — start fresh
      }
    }
    return {
      jobId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalWritten: 0,
      outputFiles: [],
    };
  }

  update(updates: Partial<Omit<CheckpointData, 'jobId' | 'startedAt'>>): void {
    this.data = { ...this.data, ...updates, updatedAt: new Date().toISOString() };
    this.save();
  }

  incrementWritten(lastUrl: string): void {
    this.update({ totalWritten: this.data.totalWritten + 1, lastUrl });
  }

  addOutputFile(filePath: string): void {
    if (!this.data.outputFiles.includes(filePath)) {
      this.update({ outputFiles: [...this.data.outputFiles, filePath] });
    }
  }

  get(): CheckpointData {
    return { ...this.data };
  }

  get totalWritten(): number {
    return this.data.totalWritten;
  }

  get lastUrl(): string | undefined {
    return this.data.lastUrl;
  }

  get isResume(): boolean {
    return this.data.totalWritten > 0;
  }

  private save(): void {
    this.fileMgr.writeAtomic(this.checkpointPath, JSON.stringify(this.data, null, 2));
  }
}
