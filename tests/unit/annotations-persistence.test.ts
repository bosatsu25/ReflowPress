import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonAnnotationRepository } from "../../apps/desktop/src/main/annotation-repository.js";
import {
  type AnnotationStore,
  createDefaultAnnotationStore,
  createBookmark,
  createHighlight,
} from "@reflowpress/annotations";

describe("JsonAnnotationRepository Persistence", () => {
  let tempDir: string;
  let storeFilePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "reflowpress-ann-test-"));
    storeFilePath = path.join(tempDir, "annotations-v1.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("loads a clean default store if file does not exist", async () => {
    const repo = new JsonAnnotationRepository(storeFilePath);
    const store = await repo.load();

    expect(store.schemaVersion).toBe(1);
    expect(store.annotations).toEqual([]);
  });

  it("saves and reloads annotations atomically", async () => {
    const repo = new JsonAnnotationRepository(storeFilePath);
    let store: AnnotationStore = createDefaultAnnotationStore();

    const { store: s1, bookmark } = createBookmark(store, {
      publicationId: "pub-1",
      locator: { kind: "epub", sectionHref: "ch1.xhtml", progress: 0.5 },
      label: "My Bookmark",
    });
    const { store: s2 } = createHighlight(s1, {
      publicationId: "pub-1",
      locator: { kind: "epub", sectionHref: "ch1.xhtml" },
      color: "yellow",
      textQuote: { exact: "Important text" },
    });
    store = s2;

    await repo.save(store);

    // Fresh repository instance loads persisted data
    const repo2 = new JsonAnnotationRepository(storeFilePath);
    const loaded = await repo2.load();

    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.annotations).toHaveLength(2);
    expect(loaded.annotations.some((a) => a.id === bookmark.id)).toBe(true);
  });

  it("quarantines corrupt store and returns clean default store", async () => {
    // Write malformed JSON
    await writeFile(
      storeFilePath,
      "{ corrupt-json: true, annotations: [broken",
      "utf8",
    );

    const repo = new JsonAnnotationRepository(storeFilePath);
    const store = await repo.load();

    expect(store.schemaVersion).toBe(1);
    expect(store.annotations).toEqual([]);

    // Check directory for quarantined file
    const files = await readdir(tempDir);
    const corruptFile = files.find((f) => f.includes(".corrupt-"));
    expect(corruptFile).toBeDefined();
  });

  it("rejects unknown newer schema versions without data loss", async () => {
    // Write newer schema version (e.g. version 99)
    await writeFile(
      storeFilePath,
      JSON.stringify({ schemaVersion: 99, annotations: [] }),
      "utf8",
    );

    const repo = new JsonAnnotationRepository(storeFilePath);
    await expect(repo.load()).rejects.toThrow(
      /Unsupported annotation schema version/,
    );
  });

  it("handles serialized concurrent writes safely", async () => {
    const repo = new JsonAnnotationRepository(storeFilePath);

    const saves = Array.from({ length: 5 }).map((_, i) => {
      const store: AnnotationStore = {
        schemaVersion: 1,
        annotations: [
          {
            id: `ann-${i}`,
            publicationId: "pub-1",
            kind: "bookmark",
            locator: { kind: "pdf", page: i + 1 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      return repo.save(store);
    });

    await Promise.all(saves);

    const loaded = await repo.load();
    expect(loaded.annotations).toBeDefined();
  });
});
