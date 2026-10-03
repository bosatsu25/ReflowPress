import * as os from "node:os";
import { performance } from "node:perf_hooks";
import { exportPublication } from "./export-orchestrator.js";
import {
  ExportError,
  type ExportOptions,
  type ExportResult,
} from "./models.js";

export interface BatchExportOptions extends ExportOptions {
  readonly jobs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?:
    | ((completed: number, total: number, currentFile: string) => void)
    | undefined;
}

export interface BatchFileResult {
  readonly inputPath: string;
  readonly success: boolean;
  readonly results?: readonly ExportResult[] | undefined;
  readonly error?: string | undefined;
  readonly errorCode?: string | undefined;
}

export interface BatchExportReport {
  readonly totalFiles: number;
  readonly successfulFiles: number;
  readonly failedFiles: number;
  readonly totalOutputs: number;
  readonly totalByteSize: number;
  readonly durationMs: number;
  readonly items: readonly BatchFileResult[];
}

/**
 * Concurrently exports multiple publications with bounded parallelism.
 */
export async function exportBatch(
  inputPaths: readonly string[],
  options: BatchExportOptions,
): Promise<BatchExportReport> {
  const startTime = performance.now();
  // Sort paths for determinism
  const sortedPaths = [...inputPaths].sort();
  const total = sortedPaths.length;

  const maxWorkers = Math.max(
    1,
    options.jobs ?? Math.min(4, os.cpus().length || 1),
  );
  const items: BatchFileResult[] = new Array(total);

  let nextIndex = 0;
  let completedCount = 0;

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      if (options.signal?.aborted) {
        throw new Error("Batch export aborted by signal.");
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      const file = sortedPaths[currentIndex]!;

      try {
        if (options.signal?.aborted) {
          throw new Error("Batch export aborted by signal.");
        }

        const results = await exportPublication(file, options);
        items[currentIndex] = {
          inputPath: file,
          success: true,
          results,
        };
      } catch (err) {
        items[currentIndex] = {
          inputPath: file,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          errorCode: err instanceof ExportError ? err.code : "UNKNOWN_ERROR",
        };
      } finally {
        completedCount += 1;
        options.onProgress?.(completedCount, total, file);
      }
    }
  }

  const workerCount = Math.min(maxWorkers, total);
  const workers = Array.from({ length: workerCount }, () => worker());

  try {
    await Promise.all(workers);
  } catch {
    // If aborted, mark remaining unvisited items as canceled
    for (let i = 0; i < total; i += 1) {
      if (!items[i]) {
        items[i] = {
          inputPath: sortedPaths[i]!,
          success: false,
          error: "Batch export aborted before processing started.",
          errorCode: "ABORTED",
        };
      }
    }
  }

  let successfulFiles = 0;
  let failedFiles = 0;
  let totalOutputs = 0;
  let totalByteSize = 0;

  for (const item of items) {
    if (item.success && item.results) {
      successfulFiles += 1;
      totalOutputs += item.results.length;
      for (const res of item.results) {
        totalByteSize += res.byteSize;
      }
    } else {
      failedFiles += 1;
    }
  }

  return {
    totalFiles: total,
    successfulFiles,
    failedFiles,
    totalOutputs,
    totalByteSize,
    durationMs: Math.round(performance.now() - startTime),
    items,
  };
}
