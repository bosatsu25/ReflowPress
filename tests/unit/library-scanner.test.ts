import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeBookId,
  findPublicationFiles,
  scanLibraryPaths,
} from "../../apps/desktop/src/main/library-scanner.js";
import { createDefaultCatalog } from "@reflowpress/library";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "../fixtures");

describe("Library Scanner", () => {
  let tempDir: string;
  let coversDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "reflowpress-scanner-test-"));
    coversDir = path.join(tempDir, "covers");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("computes deterministic canonical book IDs", () => {
    const id1 = computeBookId("C:/Books/MyBook.epub");
    const id2 = computeBookId("C:\\Books\\MyBook.epub");
    const id3 = computeBookId("c:/books/mybook.epub");

    expect(id1).toBe(id2);
    expect(id1).toBe(id3);
    expect(id1).toHaveLength(64); // SHA-256 hex string
  });

  it("recursively finds all publication files in a directory", async () => {
    const files = await findPublicationFiles([fixturesDir]);

    expect(files.some((f) => f.endsWith("sample.epub"))).toBe(true);
    expect(files.some((f) => f.endsWith("sample.pdf"))).toBe(true);
  });

  it("scans and extracts metadata from EPUB and PDF publications", async () => {
    const catalog = createDefaultCatalog();
    const { catalog: scannedCatalog, result } = await scanLibraryPaths(
      [fixturesDir],
      catalog,
      coversDir,
    );

    expect(result.added).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBe(0);

    const epubBook = scannedCatalog.books.find((b) => b.format === "epub");
    expect(epubBook).toBeDefined();
    expect(epubBook?.title).toBeTruthy();
    expect(epubBook?.format).toBe("epub");

    const pdfBook = scannedCatalog.books.find((b) => b.format === "pdf");
    expect(pdfBook).toBeDefined();
    expect(pdfBook?.format).toBe("pdf");
    expect(pdfBook?.title).toBe("sample");
  });

  it("performs incremental scanning skipping unchanged files", async () => {
    const catalog = createDefaultCatalog();

    // Initial scan
    const { catalog: catalog1, result: result1 } = await scanLibraryPaths(
      [fixturesDir],
      catalog,
      coversDir,
    );
    expect(result1.added).toBeGreaterThanOrEqual(2);

    // Second scan on identical files
    const { catalog: catalog2, result: result2 } = await scanLibraryPaths(
      [fixturesDir],
      catalog1,
      coversDir,
    );

    expect(result2.added).toBe(0);
    expect(result2.unchanged).toBe(result1.added);
    expect(catalog2.books.length).toBe(catalog1.books.length);
  });
});
