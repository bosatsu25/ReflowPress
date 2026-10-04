import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  type LibraryCatalog,
  type LibraryBook,
  CURRENT_SCHEMA_VERSION,
} from "../../packages/library/src/index.js";
import { JsonLibraryRepository } from "../../apps/desktop/src/main/library-repository.js";

describe("Catalog Performance Benchmark (Synthetic 1,000-Book Scale)", () => {
  let tempDir: string;
  let catalogPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reflowpress-bench-"));
    catalogPath = path.join(tempDir, "catalog-benchmark.json");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function generateSyntheticCatalog(bookCount: number): LibraryCatalog {
    const books: LibraryBook[] = [];
    const genres = [
      "Fiction",
      "Science",
      "History",
      "Philosophy",
      "Art",
      "Technology",
    ];

    for (let i = 1; i <= bookCount; i++) {
      const genre = genres[i % genres.length];
      books.push({
        id: `book-${i}`,
        title: `Comprehensive Reading Volume ${i}: Exploration of ${genre}`,
        creator: `Author ${i % 50}, Collaborator ${(i * 3) % 20}`,
        publisher: `ReflowPress Academic Press ${(i % 10) + 1}`,
        language: i % 3 === 0 ? "ja" : "en",
        format: i % 4 === 0 ? "pdf" : "epub",
        filePath: path.join(
          tempDir,
          `books/volume-${i}.${i % 4 === 0 ? "pdf" : "epub"}`,
        ),
        fileSizeBytes: 1024 * 100 + i * 256,
        dateAdded: new Date(Date.now() - i * 60000).toISOString(),
        lastOpened: i % 5 === 0 ? new Date().toISOString() : undefined,
        favorite: i % 10 === 0,
        tags: [genre, `Tag-${i % 20}`],
        availability: {
          exists: true,
          lastChecked: new Date().toISOString(),
        },
      });
    }

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      books,
      collections: [
        { id: "col-1", name: "Favorites", description: "Top picks" },
        {
          id: "col-2",
          name: "Technical Reference",
          description: "All computing texts",
        },
        {
          id: "col-3",
          name: "Japanese Typography",
          description: "Vertical text collection",
        },
      ],
    };
  }

  it("loads and queries a 1,000-book catalog in under 1,000ms", async () => {
    const syntheticCatalog = generateSyntheticCatalog(1000);
    const repo = new JsonLibraryRepository(catalogPath);

    // Warm-up save
    const t0Save = performance.now();
    await repo.save(syntheticCatalog);
    const saveDuration = performance.now() - t0Save;

    // Load from disk
    const t0Load = performance.now();
    const loaded = await repo.load();
    const loadDuration = performance.now() - t0Load;

    expect(loaded.books.length).toBe(1000);

    // Query & Filter benchmark (e.g. search query, genre filtering, sorting)
    const t0Query = performance.now();
    const query = "Volume 50";
    const filtered = loaded.books.filter(
      (b) =>
        b.title.toLowerCase().includes(query.toLowerCase()) ||
        b.creator?.toLowerCase().includes(query.toLowerCase()),
    );
    const sorted = [...loaded.books].sort(
      (a, b) =>
        new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
    );
    const queryDuration = performance.now() - t0Query;

    expect(filtered.length).toBeGreaterThan(0);
    expect(sorted.length).toBe(1000);

    const totalLoadAndQueryMs = loadDuration + queryDuration;

    console.log(
      `\n[Benchmark Results for 1,000 Books]:\n` +
        `  - Atomic Save:   ${saveDuration.toFixed(2)} ms\n` +
        `  - Disk Load:     ${loadDuration.toFixed(2)} ms\n` +
        `  - In-Memory Qry: ${queryDuration.toFixed(2)} ms\n` +
        `  - Total Read+Qry:${totalLoadAndQueryMs.toFixed(2)} ms (Budget: 1,000 ms)\n`,
    );

    // Assert that total read + query is comfortably under the 1,000ms budget
    expect(totalLoadAndQueryMs).toBeLessThan(1000);
  });
});
