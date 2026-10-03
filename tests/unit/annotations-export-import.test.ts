import { describe, it, expect } from "vitest";
import {
  type AnnotationStore,
  type PublicationIdentity,
  createDefaultAnnotationStore,
  createBookmark,
  createHighlight,
  createNote,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  exportAnnotationsToHtml,
  importAnnotationsFromJson,
} from "@reflowpress/annotations";

describe("Annotation Export & Import Engines", () => {
  const pubIdentity: PublicationIdentity = {
    identifier: "urn:isbn:9780000000000",
    title: "Alice's Adventures in Wonderland",
    creator: "Lewis Carroll",
    format: "epub",
  };

  let store: AnnotationStore = createDefaultAnnotationStore();
  const { store: s1 } = createBookmark(store, {
    publicationId: "pub-1",
    locator: { kind: "epub", sectionHref: "ch1.xhtml", progress: 0.1 },
    label: "Down the Rabbit-Hole",
  });
  const { store: s2, highlight } = createHighlight(s1, {
    publicationId: "pub-1",
    locator: { kind: "epub", sectionHref: "ch1.xhtml" },
    color: "pink",
    textQuote: { exact: "Curiouser and curiouser!" },
  });
  const { store: s3 } = createNote(s2, {
    publicationId: "pub-1",
    locator: { kind: "epub", sectionHref: "ch1.xhtml" },
    body: "Famous exclamation on English grammar.",
    highlightId: highlight.id,
  });
  store = s3;

  it("exports annotations to valid portable JSON", () => {
    const jsonStr = exportAnnotationsToJson(store, pubIdentity, "pub-1");
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(parsed["format"]).toBe("reflowpress-annotations");
    expect(parsed["version"]).toBe(1);
    expect(parsed["publication"]).toEqual(pubIdentity);
    expect(Array.isArray(parsed["annotations"])).toBe(true);
    expect((parsed["annotations"] as unknown[]).length).toBe(3);
  });

  it("imports valid portable JSON with lossless round-trip", () => {
    const jsonStr = exportAnnotationsToJson(store, pubIdentity, "pub-1");
    const freshStore = createDefaultAnnotationStore();

    const { store: importedStore, report } = importAnnotationsFromJson(
      jsonStr,
      "pub-target",
      freshStore,
    );

    expect(report.errors).toHaveLength(0);
    expect(report.imported).toBe(3);
    expect(importedStore.annotations).toHaveLength(3);
    expect(
      importedStore.annotations.every((a) => a.publicationId === "pub-target"),
    ).toBe(true);
  });

  it("handles duplicate and conflicting IDs deterministically during JSON import", () => {
    const jsonStr = exportAnnotationsToJson(store, pubIdentity, "pub-1");

    // 1. Import identical into existing: all skipped as duplicates
    const { report: rep1 } = importAnnotationsFromJson(jsonStr, "pub-1", store);
    expect(rep1.skippedDuplicates).toBe(3);
    expect(rep1.imported).toBe(0);

    // 2. Import file where an annotation ID collides with existing store but has different content
    const modifiedPayload = JSON.parse(jsonStr);
    modifiedPayload.annotations[0].label = "Conflicting altered label";
    const modifiedJson = JSON.stringify(modifiedPayload);

    const { store: updatedStore, report: rep2 } = importAnnotationsFromJson(
      modifiedJson,
      "pub-1",
      store,
    );

    expect(rep2.conflictsResolved).toBe(1);
    expect(rep2.skippedDuplicates).toBe(2);
    // Updated store contains both original and conflicted resolved note
    expect(updatedStore.annotations.length).toBe(store.annotations.length + 1);
  });

  it("exports human-readable Markdown format", () => {
    const md = exportAnnotationsToMarkdown(store, pubIdentity, "pub-1");

    expect(md).toContain("# Alice's Adventures in Wonderland");
    expect(md).toContain("*By Lewis Carroll*");
    expect(md).toContain("> Curiouser and curiouser!");
    expect(md).toContain("- **Color**: pink");
    expect(md).toContain("- **Note**: Famous exclamation on English grammar.");
    expect(md).toContain("Down the Rabbit-Hole");
    // Ensure no local disk paths are leaked
    expect(md).not.toContain("C:\\");
    expect(md).not.toContain("/Users/");
  });

  it("exports standalone static HTML with escaped user content and no external assets", () => {
    // Add malicious XSS content into note
    const { store: xssStore } = createNote(store, {
      publicationId: "pub-1",
      locator: { kind: "epub", sectionHref: "ch1.xhtml" },
      body: `<script>alert('xss')</script><img src="x" onerror="alert(1)"/>`,
    });

    const html = exportAnnotationsToHtml(xssStore, pubIdentity, "pub-1");

    // Must be valid HTML
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Alice&#039;s Adventures in Wonderland");
    // Must escape malicious scripts
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain(
      "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
    );
    // Must NOT contain external CDN links, remote fonts, or JS scripts
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("http://");
  });

  it("rejects invalid, oversized, or malformed import inputs safely", () => {
    const clean = createDefaultAnnotationStore();

    // 1. Invalid JSON
    const r1 = importAnnotationsFromJson("{ not-valid-json", "p1", clean);
    expect(r1.report.errors.some((e) => e.includes("Invalid JSON"))).toBe(true);

    // 2. Wrong format identifier
    const r2 = importAnnotationsFromJson(
      JSON.stringify({ format: "random-format", version: 1 }),
      "p1",
      clean,
    );
    expect(r2.report.errors.some((e) => e.includes("Invalid format"))).toBe(
      true,
    );

    // 3. Oversized note (> 64KB)
    const giantNote = "A".repeat(70000);
    const oversizedPayload = {
      format: "reflowpress-annotations",
      version: 1,
      publication: pubIdentity,
      annotations: [
        {
          id: "huge-note",
          kind: "note",
          publicationId: "p1",
          locator: { kind: "pdf", page: 1 },
          body: giantNote,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const r3 = importAnnotationsFromJson(
      JSON.stringify(oversizedPayload),
      "p1",
      clean,
    );
    expect(r3.report.errors.some((e) => e.includes("exceeds 64KB"))).toBe(true);
    expect(r3.store.annotations).toHaveLength(0);
  });
});
