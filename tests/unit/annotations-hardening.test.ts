import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonAnnotationRepository } from "../../apps/desktop/src/main/annotation-repository.js";
import {
  type Annotation,
  type AnnotationStore,
  type PublicationIdentity,
  createDefaultAnnotationStore,
  exportAnnotationsToHtml,
  exportAnnotationsToMarkdown,
  importAnnotationsFromJson,
} from "@reflowpress/annotations";

const pub: PublicationIdentity = { title: "Book", format: "epub" };
const NOW = "2026-10-01T12:00:00.000Z";

function portable(annotations: unknown[]): string {
  return JSON.stringify({
    format: "reflowpress-annotations",
    version: 1,
    publication: pub,
    exportedAt: NOW,
    annotations,
  });
}

const validHighlight = {
  id: "h-1",
  publicationId: "src",
  kind: "highlight",
  locator: { kind: "epub", sectionHref: "ch1.xhtml", progress: 0.5 },
  color: "yellow",
  textQuote: { exact: "quoted text", prefix: "a ", suffix: " b" },
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};
const validBookmark = {
  id: "b-1",
  publicationId: "src",
  kind: "bookmark",
  locator: { kind: "pdf", page: 3 },
  label: "Chapter",
  createdAt: NOW,
  updatedAt: NOW,
};
const validNote = {
  id: "n-1",
  publicationId: "src",
  kind: "note",
  locator: {
    kind: "pdf",
    page: 1,
    normalizedRects: [{ left: 0, top: 0, width: 1, height: 1 }],
  },
  body: "note body",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("Annotation HTML/Markdown export escaping", () => {
  // Records that bypassed the old import path (color/page were interpolated raw)
  const hostileStore: AnnotationStore = {
    schemaVersion: 1,
    annotations: [
      {
        ...validHighlight,
        publicationId: "p",
        color: `"><img src=x onerror=alert('color')>`,
        locator: { kind: "pdf", page: `<script>alert('hl-page')</script>` },
      },
      {
        ...validBookmark,
        publicationId: "p",
        locator: { kind: "pdf", page: `<script>alert('bm-page')</script>` },
        label: "<b>label</b>",
      },
      {
        ...validNote,
        publicationId: "p",
        locator: {
          kind: "pdf",
          page: `<img src=x onerror=alert('note-page')>`,
        },
      },
    ] as unknown as Annotation[],
  };

  it("escapes color and page in every HTML interpolation", () => {
    const html = exportAnnotationsToHtml(hostileStore, pub, "p");
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/onerror=alert\('color'\)>/);
    expect(html).toContain('<div class="highlight-item">');
    expect(html).toContain(
      "Color: &quot;&gt;&lt;img src=x onerror=alert(&#039;color&#039;)&gt;",
    );
    expect(html).toContain(
      "Page &lt;script&gt;alert(&#039;bm-page&#039;)&lt;/script&gt;",
    );
    expect(html).toContain(
      "Page &lt;img src=x onerror=alert(&#039;note-page&#039;)&gt;",
    );
    expect(html).toContain("&lt;b&gt;label&lt;/b&gt;");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });

  it("escapes user content in the Markdown export", () => {
    const md = exportAnnotationsToMarkdown(hostileStore, pub, "p");
    expect(md).not.toMatch(/<(script|img|b)\b/);
    expect(md).toContain("&lt;script&gt;alert('bm-page')&lt;/script&gt;");
    expect(md).toContain("&lt;b&gt;label&lt;/b&gt;");
  });

  it("keeps known color classes for valid highlights", () => {
    const store: AnnotationStore = {
      schemaVersion: 1,
      annotations: [{ ...validHighlight, color: "pink" } as Annotation],
    };
    const html = exportAnnotationsToHtml(store, pub);
    expect(html).toContain('<div class="highlight-item pink">');
    expect(html).toContain("Section ch1.xhtml");
  });
});

describe("Strict annotation import validation", () => {
  it("rejects the confirmed XSS payloads and keeps valid records", () => {
    const { store, report } = importAnnotationsFromJson(
      portable([
        {
          ...validHighlight,
          id: "evil-color",
          color: `"><img src=x onerror=alert(1)>`,
        },
        {
          ...validBookmark,
          id: "evil-page",
          locator: { kind: "pdf", page: "<script>alert(1)</script>" },
        },
        validHighlight,
        validBookmark,
        validNote,
      ]),
      "target",
      createDefaultAnnotationStore(),
    );

    expect(report.totalInFile).toBe(5);
    expect(report.imported).toBe(3);
    expect(report.rejected).toBe(2);
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toMatch(
      /^Record 0 \(highlight\): 'color' must be one of/,
    );
    expect(report.errors[1]).toMatch(/^Record 1 \(bookmark\): 'locator.page'/);
    expect(store.annotations.map((a) => a.id)).toEqual(["h-1", "b-1", "n-1"]);
    expect(store.annotations.every((a) => a.publicationId === "target")).toBe(
      true,
    );

    const html = exportAnnotationsToHtml(store, pub);
    expect(html).not.toMatch(/<img|<script>alert/);
  });

  const invalidRecords: Record<string, unknown> = {
    "non-object": "string",
    "array record": [validBookmark],
    "missing id": { ...validBookmark, id: undefined },
    "empty id": { ...validBookmark, id: "" },
    "id with control chars": { ...validBookmark, id: "a\u0000b" },
    "unknown kind": { ...validBookmark, kind: "script" },
    "missing locator": { ...validBookmark, locator: undefined },
    "unknown locator kind": {
      ...validBookmark,
      locator: { kind: "web", url: "x" },
    },
    "page zero": { ...validBookmark, locator: { kind: "pdf", page: 0 } },
    "fractional page": {
      ...validBookmark,
      locator: { kind: "pdf", page: 1.5 },
    },
    "string page": { ...validBookmark, locator: { kind: "pdf", page: "2" } },
    "negative zoom": {
      ...validBookmark,
      locator: { kind: "pdf", page: 1, zoom: -1 },
    },
    "bad rects": {
      ...validBookmark,
      locator: { kind: "pdf", page: 1, normalizedRects: [{ left: "x" }] },
    },
    "non-string sectionHref": {
      ...validHighlight,
      locator: { kind: "epub", sectionHref: 5 },
    },
    "progress out of range": {
      ...validHighlight,
      locator: { kind: "epub", sectionHref: "a", progress: 2 },
    },
    "bad textPosition": {
      ...validHighlight,
      locator: {
        kind: "epub",
        sectionHref: "a",
        textPosition: { start: 5, end: 1 },
      },
    },
    "unknown color": { ...validHighlight, color: "red" },
    "missing textQuote": { ...validHighlight, textQuote: undefined },
    "empty exact": { ...validHighlight, textQuote: { exact: "" } },
    "non-string prefix": {
      ...validHighlight,
      textQuote: { exact: "x", prefix: 1 },
    },
    "bad status": { ...validHighlight, status: "deleted" },
    "non-string note body": { ...validNote, body: { html: "<b>" } },
    "non-string label": { ...validBookmark, label: ["x"] },
    "bad createdAt": { ...validBookmark, createdAt: "yesterday" },
    "missing updatedAt": { ...validBookmark, updatedAt: undefined },
    "invalid calendar date": {
      ...validBookmark,
      createdAt: "2026-13-45T99:99:99Z",
    },
  };

  for (const [name, record] of Object.entries(invalidRecords)) {
    it(`rejects a record with ${name}`, () => {
      const { store, report } = importAnnotationsFromJson(
        portable([record, validBookmark]),
        "target",
        createDefaultAnnotationStore(),
      );
      expect(report.rejected).toBe(1);
      expect(report.imported).toBe(1);
      expect(report.errors).toHaveLength(1);
      expect(store.annotations).toHaveLength(1);
      expect(store.annotations[0]!.id).toBe("b-1");
    });
  }

  it("rebuilds records field by field without copying unknown properties", () => {
    // JSON.parse creates an own "__proto__" property; it must not be copied.
    const json = portable([
      {
        ...validHighlight,
        onclick: "alert(1)",
        extra: { nested: true },
        locator: { ...validHighlight.locator, injected: "<script>" },
      },
    ]).replace('"id":"h-1"', '"__proto__":{"polluted":true},"id":"h-1"');
    expect(json).toContain('"__proto__"');
    const { store, report } = importAnnotationsFromJson(
      json,
      "target",
      createDefaultAnnotationStore(),
    );
    expect(report.imported).toBe(1);
    const imported = store.annotations[0] as unknown as Record<string, unknown>;
    expect(Object.keys(imported).sort()).toEqual(
      [
        "color",
        "createdAt",
        "id",
        "kind",
        "locator",
        "publicationId",
        "status",
        "textQuote",
        "updatedAt",
      ].sort(),
    );
    expect(Object.keys(imported["locator"] as object).sort()).toEqual([
      "kind",
      "progress",
      "sectionHref",
    ]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("keeps the existing record-count and note-size limits", () => {
    const tooMany = importAnnotationsFromJson(
      portable(
        Array.from({ length: 10001 }, (_, i) => ({
          ...validBookmark,
          id: `b${i}`,
        })),
      ),
      "t",
      createDefaultAnnotationStore(),
    );
    expect(tooMany.report.errors[0]).toContain("10,000");
    expect(tooMany.report.imported).toBe(0);

    const oversizedNote = importAnnotationsFromJson(
      portable([{ ...validNote, body: "A".repeat(65537) }]),
      "t",
      createDefaultAnnotationStore(),
    );
    expect(oversizedNote.report.errors[0]).toContain("exceeds 64KB");
    expect(oversizedNote.report.rejected).toBe(1);

    const maxNote = importAnnotationsFromJson(
      portable([{ ...validNote, body: "A".repeat(65536) }]),
      "t",
      createDefaultAnnotationStore(),
    );
    expect(maxNote.report.imported).toBe(1);
  });

  it("caps the number of detailed error messages", () => {
    const { report } = importAnnotationsFromJson(
      portable(Array.from({ length: 500 }, () => ({ kind: "bogus" }))),
      "t",
      createDefaultAnnotationStore(),
    );
    expect(report.rejected).toBe(500);
    expect(report.errors.length).toBeLessThanOrEqual(101);
    expect(report.errors.at(-1)).toContain("500 invalid record(s)");
  });
});

describe("Desktop annotation repository file handling", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "reflowpress-ann-hardening-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("rejects import files over 5 MB before reading them", async () => {
    const repo = new JsonAnnotationRepository(path.join(dir, "store.json"));
    const big = path.join(dir, "big.json");
    await writeFile(big, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));

    const report = await repo.importFromFile(big, "pub");
    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([
      "Import file exceeds maximum size limit (5MB)",
    ]);
    expect(await readdir(dir)).toEqual(["big.json"]);
  });

  it("rejects non-regular import sources", async () => {
    const repo = new JsonAnnotationRepository(path.join(dir, "store.json"));
    const report = await repo.importFromFile(dir, "pub");
    expect(report.errors).toEqual(["Import source is not a regular file"]);
  });

  it("imports a valid file within the limit", async () => {
    const repo = new JsonAnnotationRepository(path.join(dir, "store.json"));
    const source = path.join(dir, "in.json");
    await writeFile(
      source,
      portable([
        validBookmark,
        { ...validBookmark, id: "x", color: 1, kind: "nope" },
      ]),
    );

    const report = await repo.importFromFile(source, "pub");
    expect(report.imported).toBe(1);
    expect(report.rejected).toBe(1);
    expect((await repo.load()).annotations).toHaveLength(1);
  });

  it("removes the temp file when an export cannot be renamed into place", async () => {
    const repo = new JsonAnnotationRepository(path.join(dir, "store.json"));
    const target = path.join(dir, "export.html");
    await mkdir(target); // rename(temp, <directory>) fails

    await expect(repo.exportToFile(pub, "html", target)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["export.html"]);
  });

  it("removes the temp file when a save fails and keeps later saves working", async () => {
    const storePath = path.join(dir, "store.json");
    const repo = new JsonAnnotationRepository(storePath);
    await mkdir(storePath); // the store path is occupied by a directory

    await expect(repo.save(createDefaultAnnotationStore())).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["store.json"]);

    await rm(storePath, { recursive: true });
    await repo.save(createDefaultAnnotationStore());
    expect(await readdir(dir)).toEqual(["store.json"]);
    expect((await repo.load()).annotations).toEqual([]);
  });
});
