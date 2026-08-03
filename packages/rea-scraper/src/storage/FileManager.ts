import { mkdirSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Handles directory creation, atomic rename-based writes, and path generation.
 */
export class FileManager {
  ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  ensureDirForFile(filePath: string): void {
    this.ensureDir(dirname(filePath));
  }

  /**
   * Atomic write via temp file + rename.
   * Safe for small files (checkpoints, manifests). Not for streaming.
   */
  writeAtomic(filePath: string, content: string): void {
    const tmp = filePath + '.tmp';
    this.ensureDirForFile(filePath);
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, filePath);
  }

  buildFilePath(outputDir: string, prefix: string, suffix: string, ext: string): string {
    return join(outputDir, `${prefix}_${suffix}.${ext}`);
  }

  buildTimestampSuffix(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }
}
