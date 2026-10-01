import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReadingPositionStore } from "../../apps/desktop/src/main/reading-position-store.js";
import {
  normalizeResourcePath,
  resolveResourceHref,
} from "../../apps/desktop/src/renderer/reader/resource-manager.js";
import type { SavedReadingPosition } from "@reflowpress/reader";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("ReadingPositionStore", () => {
  let tempDir: string;
  let storeFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "reflowpress-store-test-"));
    storeFile = path.join(tempDir, "state.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for unsaved publication", async () => {
    const store = new ReadingPositionStore(storeFile);
    const pos = await store.getPosition("non-existent");
    expect(pos).toBeNull();
  });

  it("persists and restores EPUB reading position atomically", async () => {
    const store = new ReadingPositionStore(storeFile);
    const position: SavedReadingPosition = {
      publicationId: "urn:uuid:book-123",
      location: {
        kind: "epub",
        sectionId: "ch1",
        sectionHref: "Text/ch1.xhtml",
        progress: 0.45,
      },
      updatedAt: "2026-10-02T00:00:00Z",
    };

    await store.savePosition(position);

    // Verify in-memory retrieval
    const retrieved = await store.getPosition("urn:uuid:book-123");
    expect(retrieved).toEqual(position);

    // Verify file content on disk
    const content = await readFile(storeFile, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.positions["urn:uuid:book-123"]).toEqual(position);

    // Verify new instance reading from file
    const newStore = new ReadingPositionStore(storeFile);
    const reloaded = await newStore.getPosition("urn:uuid:book-123");
    expect(reloaded).toEqual(position);
  });

  it("persists and restores PDF reading position", async () => {
    const store = new ReadingPositionStore(storeFile);
    const position: SavedReadingPosition = {
      publicationId: "path:/docs/manual.pdf",
      location: {
        kind: "pdf",
        page: 7,
        zoom: 1.25,
      },
      updatedAt: "2026-10-02T01:00:00Z",
    };

    await store.savePosition(position);
    const retrieved = await store.getPosition("path:/docs/manual.pdf");
    expect(retrieved).toEqual(position);
  });

  it("handles corrupted state file gracefully by starting fresh", async () => {
    await writeFile(storeFile, "INVALID JSON CONTENT {{{", "utf8");
    const store = new ReadingPositionStore(storeFile);

    const pos = await store.getPosition("any");
    expect(pos).toBeNull();

    // Should still allow saving new positions safely
    const newPos: SavedReadingPosition = {
      publicationId: "recovered",
      location: { kind: "pdf", page: 1, zoom: 1.0 },
      updatedAt: "2026-10-02T02:00:00Z",
    };
    await store.savePosition(newPos);
    expect(await store.getPosition("recovered")).toEqual(newPos);
  });
});

describe("Resource Path Utilities", () => {
  it("normalizes path with relative segments", () => {
    expect(normalizeResourcePath("OEBPS/Text/../Images/cover.jpg")).toBe(
      "OEBPS/Images/cover.jpg",
    );
    expect(normalizeResourcePath("./styles/main.css")).toBe("styles/main.css");
    expect(normalizeResourcePath("a/b/../../c.xhtml")).toBe("c.xhtml");
  });

  it("resolves relative href from base section", () => {
    expect(
      resolveResourceHref("OEBPS/Text/chapter1.xhtml", "../Images/fig1.png"),
    ).toBe("OEBPS/Images/fig1.png");
    expect(
      resolveResourceHref("OEBPS/Text/chapter1.xhtml", "chapter2.xhtml#part2"),
    ).toBe("OEBPS/Text/chapter2.xhtml#part2");
    expect(resolveResourceHref("OEBPS/content.opf", "images/pic.jpg")).toBe(
      "OEBPS/images/pic.jpg",
    );
  });

  it("preserves absolute or special URIs unchanged", () => {
    expect(
      resolveResourceHref(
        "OEBPS/Text/ch.xhtml",
        "https://example.com/font.woff",
      ),
    ).toBe("https://example.com/font.woff");
    expect(
      resolveResourceHref("OEBPS/Text/ch.xhtml", "data:image/png;base64,123"),
    ).toBe("data:image/png;base64,123");
    expect(resolveResourceHref("OEBPS/Text/ch.xhtml", "#anchor")).toBe(
      "#anchor",
    );
  });
});
