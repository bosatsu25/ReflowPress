import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface TransactionalWriteResult {
  readonly targetPath: string;
  readonly byteSize: number;
}

/**
 * Execute a transactional file write operation.
 * Writes to a temporary staging file first, then atomically moves/renames
 * it to the target path. Cleans up staging artifacts on error.
 */
export async function executeTransactionalWrite(
  targetPath: string,
  writer: (stagingPath: string) => Promise<void>,
): Promise<TransactionalWriteResult> {
  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true });

  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingFilename = `.${path.basename(targetPath)}.tmp-${Date.now()}-${randomSuffix}`;
  const stagingPath = path.join(targetDir, stagingFilename);

  try {
    await writer(stagingPath);
    const stats = await fs.stat(stagingPath);

    // Atomic rename within the same directory
    try {
      await fs.rename(stagingPath, targetPath);
    } catch {
      // Fallback for cross-device or permission edge cases
      await fs.copyFile(stagingPath, targetPath);
      await fs.unlink(stagingPath).catch(() => {});
    }

    return {
      targetPath,
      byteSize: stats.size,
    };
  } catch (error) {
    await fs.unlink(stagingPath).catch(() => {});
    throw error;
  }
}

/**
 * Execute a transactional directory write operation (e.g., for Markdown companion asset directory).
 * Stages assets in a temporary staging folder, then moves to target directory.
 */
export async function executeTransactionalDirectoryWrite(
  targetDir: string,
  writer: (stagingDir: string) => Promise<void>,
): Promise<void> {
  const parentDir = path.dirname(targetDir);
  await fs.mkdir(parentDir, { recursive: true });

  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingDir = path.join(
    parentDir,
    `.${path.basename(targetDir)}.tmp-${Date.now()}-${randomSuffix}`,
  );
  await fs.mkdir(stagingDir, { recursive: true });

  try {
    await writer(stagingDir);

    // If targetDir already exists, remove it before renaming staging
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    try {
      await fs.rename(stagingDir, targetDir);
    } catch {
      await fs.cp(stagingDir, targetDir, { recursive: true });
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
