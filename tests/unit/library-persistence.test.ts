import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonLibraryRepository } from "../../apps/desktop/src/main/library-repository.js";
import {
  type LibraryBook,
  createDefaultCatalog,
  addBookToCatalog,
} from "@reflowpress/library";

describe("JsonLibraryRepository Persistence", () => {
  let tempDir: string;
  let catalogFilePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "reflowpress-lib-test-"));
    catalogFilePath = path.join(tempDir, "library-v1.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("loads a default clean catalog if file does not exist", async () => {
    const repo = new JsonLibraryRepository(catalogFilePath);
    const catalog = await repo.load();

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.books).toEqual([]);
    expect(catalog.collections).toEqual([]);
    expect(catalog.scanPaths).toEqual([]);
  });

  it("saves and reloads catalog data atomically", async () => {
    const repo = new JsonLibraryRepository(catalogFilePath);
    let catalog = createDefaultCatalog();

    const book: LibraryBook = {
      id: "hash-123",
      filePath: path.join(tempDir, "sample.epub"),
      format: "epub",
      title: "Test Publication",
      creator: "Author Name",
      dateAdded: new Date().toISOString(),
      fileSizeBytes: 2048,
      modifiedTimeMs: Date.now(),
      tags: ["fiction"],
      collectionIds: [],
      availability: { exists: true, lastChecked: new Date().toISOString() },
    };

    catalog = addBookToCatalog(catalog, book);
    await repo.save(catalog);

    // Reload with fresh repository instance
    const repo2 = new JsonLibraryRepository(catalogFilePath);
    const loaded = await repo2.load();

    expect(loaded.books).toHaveLength(1);
    expect(loaded.books[0]?.id).toBe("hash-123");
    expect(loaded.books[0]?.title).toBe("Test Publication");
  });

  it("quarantines corrupt catalog and returns clean default catalog", async () => {
    // Write invalid corrupted JSON
    await writeFile(
      catalogFilePath,
      "{ invalid-json: true, schemaVersion: 1",
      "utf8",
    );

    const repo = new JsonLibraryRepository(catalogFilePath);
    const catalog = await repo.load();

    // Must return clean catalog
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.books).toEqual([]);

    // Check directory: should contain quarantined .corrupt-* file
    const files = await readdir(tempDir);
    const corruptFile = files.find((f) => f.includes(".corrupt-"));
    expect(corruptFile).toBeDefined();
  });

  it("verifies book file availability against disk state", async () => {
    const existingFile = path.join(tempDir, "exists.epub");
    await writeFile(existingFile, "content", "utf8");

    const missingFile = path.join(tempDir, "missing.pdf");

    let catalog = createDefaultCatalog();
    const book1: LibraryBook = {
      id: "book-1",
      filePath: existingFile,
      format: "epub",
      title: "Existing Book",
      dateAdded: new Date().toISOString(),
      fileSizeBytes: 7,
      modifiedTimeMs: Date.now(),
      tags: [],
      collectionIds: [],
      availability: { exists: false, lastChecked: new Date().toISOString() },
    };
    const book2: LibraryBook = {
      id: "book-2",
      filePath: missingFile,
      format: "pdf",
      title: "Missing Book",
      dateAdded: new Date().toISOString(),
      fileSizeBytes: 100,
      modifiedTimeMs: Date.now(),
      tags: [],
      collectionIds: [],
      availability: { exists: true, lastChecked: new Date().toISOString() },
    };

    catalog = addBookToCatalog(catalog, book1);
    catalog = addBookToCatalog(catalog, book2);

    const repo = new JsonLibraryRepository(catalogFilePath);
    const verified = await repo.verifyAvailability(catalog);

    const v1 = verified.books.find((b) => b.id === "book-1");
    const v2 = verified.books.find((b) => b.id === "book-2");

    expect(v1?.availability.exists).toBe(true);
    expect(v2?.availability.exists).toBe(false);
  });
});
