import * as path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportBatch } from "@reflowpress/export";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TEMP_OUTPUT_DIR = path.resolve(
  __dirname,
  "../../scratch/batch-test-output",
);

describe("Batch Exporter", () => {
  const sampleEpub = path.join(FIXTURES_DIR, "sample.epub");
  const japaneseEpub = path.join(FIXTURES_DIR, "sample-japanese.epub");

  beforeEach(async () => {
    await fs.mkdir(TEMP_OUTPUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs
      .rm(TEMP_OUTPUT_DIR, { recursive: true, force: true })
      .catch(() => {});
  });

  it("exports multiple EPUB publications concurrently with progress callbacks", async () => {
    const progressReports: string[] = [];

    const report = await exportBatch([sampleEpub, japaneseEpub], {
      format: "html",
      outputDir: TEMP_OUTPUT_DIR,
      jobs: 2,
      onProgress: (done, total, file) => {
        progressReports.push(`${done}/${total}: ${path.basename(file)}`);
      },
    });

    expect(report.totalFiles).toBe(2);
    expect(report.successfulFiles).toBe(2);
    expect(report.failedFiles).toBe(0);
    expect(report.totalOutputs).toBe(2);
    expect(report.totalByteSize).toBeGreaterThan(0);
    expect(progressReports.length).toBe(2);
  }, 20000);

  it("handles partial failure without interrupting remaining jobs", async () => {
    const nonExistentEpub = path.join(FIXTURES_DIR, "non-existent-book.epub");

    const report = await exportBatch([sampleEpub, nonExistentEpub], {
      format: "markdown",
      outputDir: TEMP_OUTPUT_DIR,
      jobs: 2,
    });

    expect(report.totalFiles).toBe(2);
    expect(report.successfulFiles).toBe(1);
    expect(report.failedFiles).toBe(1);
    const failedItem = report.items.find((item) => !item.success);
    expect(failedItem).toBeDefined();
    expect(failedItem?.errorCode).toBe("INPUT_NOT_FOUND");
  }, 20000);

  it("respects AbortSignal cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    const report = await exportBatch([sampleEpub, japaneseEpub], {
      format: "html",
      outputDir: TEMP_OUTPUT_DIR,
      signal: controller.signal,
    });

    expect(report.failedFiles).toBe(2);
    expect(report.successfulFiles).toBe(0);
  });
});
