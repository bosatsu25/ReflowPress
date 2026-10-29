import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  constants as zlibConstants,
  deflateRawSync,
  deflateSync,
} from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOADER_LIMITS } from "@reflowpress/epub";
import {
  DEFAULT_PDF_INSPECTION_LIMITS,
  extractReferencesFromCss,
  extractReferencesFromXml,
  getRuleDefinition,
  inspectEpubHealth,
  inspectPdfHealth,
  resolveEpubArchiveLimits,
  type HealthReport,
} from "../../packages/quality/src/index.js";
import { computeCrc32 } from "../../packages/repair/src/rewriter.js";

// Generous wall-clock bound: each crafted input below previously took tens of
// seconds (or exhausted memory); the hardened code finishes in milliseconds.
const TIME_LIMIT_MS = 2000;

const MiB = 1024 * 1024;

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "reflowpress-quality-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("EPUB inspection resource limits", () => {
  it("uses the EPUB loader limits by default and ignores invalid overrides", () => {
    expect(resolveEpubArchiveLimits()).toEqual(DEFAULT_LOADER_LIMITS);
    expect(
      resolveEpubArchiveLimits({ maxEntries: -1, maxMarkupBytes: 1.5 }),
    ).toEqual(DEFAULT_LOADER_LIMITS);
    expect(resolveEpubArchiveLimits({ maxEntries: 7 }).maxEntries).toBe(7);
    expect(getRuleDefinition("EPUB-SEC-003")?.defaultSeverity).toBe("fatal");
    expect(getRuleDefinition("EPUB-CONTAINER-006")?.defaultSeverity).toBe(
      "fatal",
    );
  });

  it("does not decompress a non-manifest orphan entry (400 MiB deflate bomb)", async () => {
    // Before the fix every *.xhtml entry was read in full, so this ~400 KB
    // EPUB drove RSS above 1.3 GB. The orphan also lies about its size: had it
    // been read, a corrupt-entry finding would appear.
    const epubPath = await writeZip(
      "orphan-bomb.epub",
      minimalEpub({
        extra: [
          {
            name: "OEBPS/bomb.xhtml",
            method: 8,
            data: deflateBomb(400),
            uncompressedSize: 100,
            crc: 0,
          },
        ],
      }),
    );

    const report = await timed(() => inspectEpubHealth(epubPath));

    expect(report.summary.fatalCount).toBe(0);
    expect(report.summary.errorCount).toBe(0);
    expect(findRule(report, "EPUB-CONTAINER-006")).toBeUndefined();
    const orphan = findRule(report, "EPUB-RESOURCE-001");
    expect(orphan?.location?.path).toBe("OEBPS/bomb.xhtml");
  });

  it("reports a manifest document above the markup limit without reading it", async () => {
    const epubPath = await writeZip(
      "honest-bomb.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          method: 8,
          data: deflateBomb(400),
          uncompressedSize: 400 * MiB,
          crc: 0,
        },
      }),
    );

    const report = await timed(() => inspectEpubHealth(epubPath));

    const finding = findRule(report, "EPUB-SEC-003");
    expect(finding?.severity).toBe("fatal");
    expect(finding?.location?.path).toBe("OEBPS/c1.xhtml");
    expect(finding?.message).toContain(
      String(DEFAULT_LOADER_LIMITS.maxMarkupBytes),
    );
  });

  it("stops at the first chunk when an entry inflates beyond its declared size", async () => {
    const epubPath = await writeZip(
      "lying-bomb.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          method: 8,
          data: deflateBomb(400),
          uncompressedSize: 100,
          crc: 0,
        },
      }),
    );

    const report = await timed(() => inspectEpubHealth(epubPath));

    const finding = findRule(report, "EPUB-CONTAINER-006");
    expect(finding?.severity).toBe("fatal");
    expect(finding?.location?.path).toBe("OEBPS/c1.xhtml");
  });

  it("enforces a running total of decompressed bytes across entries", async () => {
    const chapters = [2, 3, 4, 5].map((n) => ({
      name: `OEBPS/c${n}.xhtml`,
      content: `<html><body><p>${"x".repeat(600)}</p></body></html>`,
    }));
    const epubPath = await writeZip(
      "total-limit.epub",
      minimalEpub({ extraManifest: chapters }),
    );

    const report = await inspectEpubHealth(epubPath, {
      limits: { maxTotalLoadedBytes: 2500 },
    });

    const finding = report.findings.find(
      (f) =>
        f.ruleId === "EPUB-SEC-003" &&
        f.message.includes("total decompressed-size limit"),
    );
    expect(finding?.severity).toBe("fatal");
    // The report is still produced for what was inspected before the limit.
    expect(report.rulesExecuted).toContain("EPUB-RESOURCE-001");
  });

  it("rejects archives above the default size limit before opening them", async () => {
    const epubPath = path.join(tempDir, "huge.epub");
    const handle = await fs.open(epubPath, "w");
    try {
      // Sparse file: no data is written to disk.
      await handle.truncate(DEFAULT_LOADER_LIMITS.maxArchiveBytes + 1);
    } finally {
      await handle.close();
    }

    const report = await timed(() => inspectEpubHealth(epubPath));

    const finding = findRule(report, "EPUB-SEC-003");
    expect(finding?.severity).toBe("fatal");
    expect(report.summary.fatalCount).toBe(1);
  });

  it("rejects archives with more entries than the default limit", async () => {
    const entries: RawZipEntry[] = [];
    for (let i = 0; i <= DEFAULT_LOADER_LIMITS.maxEntries; i += 1) {
      entries.push({ name: `f${i}`, content: "" });
    }
    const epubPath = await writeZip("many-entries.epub", entries);

    const report = await timed(() => inspectEpubHealth(epubPath));

    const finding = findRule(report, "EPUB-SEC-003");
    expect(finding?.severity).toBe("fatal");
    expect(finding?.message).toContain(
      String(DEFAULT_LOADER_LIMITS.maxEntries),
    );
  });

  it("caps the number of findings reported per rule", async () => {
    const images = Array.from(
      { length: 5000 },
      (_, i) => `<img src="missing-${i}.png"/>`,
    ).join("");
    const epubPath = await writeZip(
      "many-findings.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          content: `<html><body>${images}</body></html>`,
        },
      }),
    );

    const report = await timed(() => inspectEpubHealth(epubPath));

    const broken = report.findings.filter(
      (f) => f.ruleId === "EPUB-RESOURCE-002",
    );
    expect(broken.length).toBe(1001);
    const summary = broken.find((f) =>
      f.evidence?.some((e) => e.key === "suppressedCount"),
    );
    expect(
      summary?.evidence?.find((e) => e.key === "suppressedCount")?.value,
    ).toBe(4000);
    expect(summary?.severity).toBe("warning");
  });
});

describe("EPUB archive entries rejected by the ZIP reader (L9)", () => {
  it.each([
    ["parent traversal", "../evil.xhtml"],
    ["absolute path", "/abs.xhtml"],
    ["drive letter", "C:/evil.xhtml"],
    ["backslash", "OEBPS\\evil.xhtml"],
    ["dot segment", "OEBPS/./evil.xhtml"],
  ])(
    "reports %s entry names as EPUB-SEC-001 instead of throwing",
    async (_label, entryName) => {
      const epubPath = await writeZip(
        "unsafe-name.epub",
        minimalEpub({ extra: [{ name: entryName, content: "<html/>" }] }),
      );

      const report = await inspectEpubHealth(epubPath);

      const finding = findRule(report, "EPUB-SEC-001");
      expect(finding?.severity).toBe("fatal");
      expect(finding?.category).toBe("security");
    },
  );

  it("reports encrypted entries instead of throwing", async () => {
    const content = Buffer.from("<html><body><p>secret</p></body></html>");
    const epubPath = await writeZip(
      "encrypted.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          // Traditional PKWARE encryption: 12-byte header before the data.
          data: Buffer.concat([Buffer.alloc(12), content]),
          uncompressedSize: content.length,
          crc: computeCrc32(content),
          flags: 0x0801,
        },
      }),
    );

    const report = await inspectEpubHealth(epubPath);

    const finding = findRule(report, "EPUB-CONTAINER-006");
    expect(finding?.location?.path).toBe("OEBPS/c1.xhtml");
    expect(finding?.message).toMatch(/encrypted/);
  });

  it("reports strong encryption, which aborts entry enumeration, instead of throwing", async () => {
    const epubPath = await writeZip(
      "strong-encryption.epub",
      minimalEpub({
        extra: [{ name: "OEBPS/x.bin", content: "data", flags: 0x0841 }],
      }),
    );

    const report = await inspectEpubHealth(epubPath);

    expect(findRule(report, "EPUB-CONTAINER-006")?.severity).toBe("fatal");
  });

  it("reports unsupported compression methods instead of throwing", async () => {
    const epubPath = await writeZip(
      "bzip2.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          content: "<html><body/></html>",
          method: 12,
        },
      }),
    );

    const report = await inspectEpubHealth(epubPath);

    const finding = findRule(report, "EPUB-CONTAINER-006");
    expect(finding?.location?.path).toBe("OEBPS/c1.xhtml");
  });

  it("reports CRC mismatches and duplicate entry names", async () => {
    const crcPath = await writeZip(
      "crc.epub",
      minimalEpub({
        chapter: {
          name: "OEBPS/c1.xhtml",
          content: "<html><body/></html>",
          crc: 0x12345678,
        },
      }),
    );
    const crcReport = await inspectEpubHealth(crcPath);
    expect(findRule(crcReport, "EPUB-CONTAINER-006")?.location?.path).toBe(
      "OEBPS/c1.xhtml",
    );

    const duplicatePath = await writeZip(
      "duplicate.epub",
      minimalEpub({
        extra: [{ name: "OEBPS/c1.xhtml", content: "<html><body/></html>" }],
      }),
    );
    const duplicateReport = await inspectEpubHealth(duplicatePath);
    const duplicate = findRule(duplicateReport, "EPUB-CONTAINER-006");
    expect(duplicate?.location?.path).toBe("OEBPS/c1.xhtml");
  });

  it("reports a non-ZIP file as EPUB-CONTAINER-001", async () => {
    const filePath = path.join(tempDir, "not-a-zip.epub");
    await fs.writeFile(filePath, "definitely not a zip archive");

    const report = await inspectEpubHealth(filePath);

    expect(findRule(report, "EPUB-CONTAINER-001")?.severity).toBe("fatal");
  });
});

describe("CSS url() extraction (ReDoS)", () => {
  it("inspects the reported 724-byte CSS ReDoS EPUB quickly", async () => {
    const epubPath = await writeZip(
      "css-redos.epub",
      minimalEpub({
        extraManifest: [
          {
            name: "OEBPS/style.css",
            content: `a{background:url(${" ".repeat(6000)}`,
            method: 8,
          },
        ],
      }),
    );
    expect((await fs.stat(epubPath)).size).toBeLessThan(4096);

    const report = await timed(() => inspectEpubHealth(epubPath));
    expect(report.summary.fatalCount).toBe(0);
  });

  it.each([
    ["unterminated url( and spaces", `a{b:url(${" ".repeat(2 * MiB)}`],
    ["unterminated value and spaces", `a{b:url(x${" ".repeat(2 * MiB)}`],
    ["quoted value and spaces", `a{b:url("x"${" ".repeat(2 * MiB)}`],
    ["nested url(", "url(".repeat(MiB / 2)],
    ["unterminated quotes", 'url("'.repeat(MiB / 2)],
    ["values separated by spaces", "url(x ".repeat(MiB / 3)],
  ])("extracts references in linear time: %s", (_label, css) => {
    const start = performance.now();
    extractReferencesFromCss(css);
    expect(performance.now() - start).toBeLessThan(TIME_LIMIT_MS);
  });

  it("extracts XML references in linear time on adversarial attributes", () => {
    const start = performance.now();
    extractReferencesFromXml(`src="${"x".repeat(2 * MiB)}`);
    extractReferencesFromXml(`src=${" ".repeat(64)}`.repeat(MiB / 70));
    extractReferencesFromXml("src=".repeat(MiB / 4));
    expect(performance.now() - start).toBeLessThan(TIME_LIMIT_MS);
  });

  it("still extracts ordinary url() forms", () => {
    expect(
      extractReferencesFromCss(
        `a{background:url(img/a.png)} b{src:url( "fonts/b.woff" )} c{x:URL('c d.png')} d{x:url(data:image/png;base64,AAA)} e{x:url(https://x.test/a.png)} f{x:url(#frag)}`,
      ),
    ).toEqual(["img/a.png", "fonts/b.woff", "c d.png"]);
  });
});

describe("PDF inspection hardening", () => {
  it("clamps the /Count fallback (67-byte PDF with /Count 99999999999)", () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Pages/Count 99999999999>>endobj\ntrailer\n",
      "latin1",
    );
    expect(pdf.length).toBeLessThan(80);

    const report = timedSync(() => inspectPdfHealth(pdf, "count.pdf"));

    const truncation = findRule(report, "PDF-STRUCT-004");
    expect(truncation?.severity).toBe("warning");
    expect(
      truncation?.evidence?.find((e) => e.key === "inspectedPages")?.value,
    ).toBe(DEFAULT_PDF_INSPECTION_LIMITS.maxInspectedPages);
    expect(findRule(report, "PDF-STRUCT-002")).toBeUndefined();
  });

  it("caps decompression and inflates a shared content stream only once", () => {
    // 64 MiB of spaces (~64 KB compressed) shared by 200 pages: previously
    // inflated in full 200 times.
    const bomb = deflateSync(Buffer.alloc(64 * MiB, 0x20));
    const parts = ["%PDF-1.4\n"];
    for (let i = 0; i < 200; i += 1) {
      parts.push(`${i + 2} 0 obj<</Type/Page/Contents 1 0 R>>endobj\n`);
    }
    const pdf = Buffer.concat([
      Buffer.from(parts.join(""), "latin1"),
      Buffer.from("1 0 obj<</Filter /FlateDecode>>\nstream\n", "latin1"),
      bomb,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);

    const report = timedSync(() => inspectPdfHealth(pdf, "bomb.pdf"));

    const truncation = report.findings.find(
      (f) => f.ruleId === "PDF-STRUCT-004" && f.message.includes("Decompress"),
    );
    expect(truncation).toBeDefined();
  });

  it("enforces a total decompression budget across content streams", () => {
    const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
    for (let i = 0; i < 10; i += 1) {
      const text = Buffer.from(`BT (page ${i}) Tj ET${" ".repeat(512 * 1024)}`);
      parts.push(
        Buffer.from(
          `${i + 100} 0 obj<</Type/Page/Contents ${i + 1} 0 R>>endobj\n${i + 1} 0 obj<</Filter /FlateDecode>>\nstream\n`,
          "latin1",
        ),
        deflateSync(text),
        Buffer.from("\nendstream\nendobj\n", "latin1"),
      );
    }

    const report = inspectPdfHealth(Buffer.concat(parts), "budget.pdf", {
      limits: { maxTotalInflatedBytes: 2 * MiB },
    });

    expect(
      report.findings.some(
        (f) =>
          f.ruleId === "PDF-STRUCT-004" && f.message.includes("Decompress"),
      ),
    ).toBe(true);
  });

  it("caps the number of inspected page objects", () => {
    const parts = ["%PDF-1.4\n"];
    for (let i = 0; i < 25; i += 1) {
      parts.push(`${i + 1} 0 obj<</Type/Page>>endobj\n`);
    }

    const report = inspectPdfHealth(
      Buffer.from(parts.join(""), "latin1"),
      "pages.pdf",
      { limits: { maxInspectedPages: 10 } },
    );

    const truncation = findRule(report, "PDF-STRUCT-004");
    expect(
      truncation?.evidence?.find((e) => e.key === "pageObjects")?.value,
    ).toBe(25);
    expect(
      report.findings.filter((f) => f.ruleId === "PDF-TEXT-001").length,
    ).toBe(10);
  });

  it("rejects input above the size limit without parsing it", () => {
    const limited = inspectPdfHealth(
      Buffer.from("%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n", "latin1"),
      "small.pdf",
      { limits: { maxInputBytes: 16 } },
    );
    expect(findRule(limited, "PDF-STRUCT-003")?.severity).toBe("fatal");

    // Default limit: the buffer's pages are never touched.
    const oversized = new Uint8Array(
      DEFAULT_PDF_INSPECTION_LIMITS.maxInputBytes + 1,
    );
    const report = timedSync(() => inspectPdfHealth(oversized, "big.pdf"));
    expect(findRule(report, "PDF-STRUCT-003")?.severity).toBe("fatal");
    expect(report.summary.fatalCount).toBe(1);
  });

  const page = "1 0 obj<</Type/Page/Contents 2 0 R>>endobj\n";
  const withContent = (content: string) =>
    `%PDF-1.4\n${page}2 0 obj<<>>\nstream\n${content}\nendstream\nendobj\n`;

  it.each([
    ["long digit run (object header scan)", `%PDF-1.4\n${"1".repeat(200_000)}`],
    ["unterminated objects", `%PDF-1.4\n${"1 0 obj ".repeat(150_000)}`],
    [
      "inline /Encrypt << without >>",
      `%PDF-1.4\n${"/Encrypt<<".repeat(100_000)}`,
    ],
    [
      "/Type/Pages without /Count",
      `%PDF-1.4\n${"/Type/Pages".repeat(200_000)}`,
    ],
    ["BI/ID without EI", withContent("BI ID ".repeat(3_000))],
    ["BT without ET", withContent("BT ".repeat(200_000))],
    ["unterminated Tj strings", withContent(`BT ${"(".repeat(200_000)} ET`)],
    [
      "unterminated TJ strings",
      withContent(`BT [${"(".repeat(200_000)}] TJ ET`),
    ],
  ])("scans in linear time: %s", (_label, text) => {
    const report = timedSync(() =>
      inspectPdfHealth(Buffer.from(text, "latin1"), "redos.pdf"),
    );
    expect(report.publicationType).toBe("pdf");
  });

  it("keeps text and image detection for ordinary content streams", () => {
    const content =
      "BT /F1 12 Tf (Hello) Tj ET\nBT [(Wor) -20 (ld)] TJ ET\nq /Im1 Do Q";
    const flate = deflateSync(Buffer.from(content, "latin1"));
    const pdf = Buffer.concat([
      Buffer.from(
        "%PDF-1.7\n1 0 obj<</Type/Page/MediaBox [0 0 612 792]/Contents 2 0 R>>endobj\n" +
          "3 0 obj<</Type/Page/MediaBox [0 0 612 792]/Contents 4 0 R>>endobj\n" +
          `2 0 obj<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\n` +
          "4 0 obj<</Filter /FlateDecode>>\nstream\n",
        "latin1",
      ),
      flate,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);

    const report = inspectPdfHealth(pdf, "ok.pdf");

    expect(report.summary.fatalCount).toBe(0);
    expect(report.summary.errorCount).toBe(0);
    expect(findRule(report, "PDF-TEXT-001")).toBeUndefined();
    expect(findRule(report, "PDF-STRUCT-004")).toBeUndefined();
    // "Hello" + "Wor" + "ld" = 10 characters per page, 20 in total (>= 20).
    expect(findRule(report, "PDF-TEXT-002")).toBeUndefined();
  });
});

interface RawZipEntry {
  readonly name: string;
  /** Plain content; stored, or deflated when `method` is 8 and `data` is unset. */
  readonly content?: string;
  /** Exact bytes to place in the archive (already compressed if needed). */
  readonly data?: Buffer;
  readonly method?: number;
  readonly crc?: number;
  readonly uncompressedSize?: number;
  readonly flags?: number;
}

function minimalEpub(
  options: {
    chapter?: RawZipEntry;
    extra?: readonly RawZipEntry[];
    extraManifest?: readonly RawZipEntry[];
  } = {},
): RawZipEntry[] {
  const chapter = options.chapter ?? {
    name: "OEBPS/c1.xhtml",
    content: "<html><body><p>Chapter</p></body></html>",
  };
  const extraManifest = options.extraManifest ?? [];
  const manifestItems = [chapter, ...extraManifest]
    .map((entry, i) => {
      const href = entry.name.slice("OEBPS/".length);
      const mediaType = href.endsWith(".css")
        ? "text/css"
        : "application/xhtml+xml";
      return `<item id="i${i}" href="${href}" media-type="${mediaType}"/>`;
    })
    .join("");
  return [
    { name: "mimetype", content: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      content:
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "OEBPS/content.opf",
      content: `<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest>${manifestItems}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="i0"/></spine></package>`,
    },
    chapter,
    {
      name: "OEBPS/nav.xhtml",
      content:
        '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
    },
    ...extraManifest,
    ...(options.extra ?? []),
  ];
}

/** Raw-deflate stream of `mebibytes` MiB of spaces, about 1 KB per MiB. */
function deflateBomb(mebibytes: number): Buffer {
  const block = deflateRawSync(Buffer.alloc(MiB, 0x20), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  });
  const blocks: Buffer[] = new Array<Buffer>(mebibytes).fill(block);
  return Buffer.concat([...blocks, deflateRawSync(Buffer.alloc(0))]);
}

function buildZip(entries: readonly RawZipEntry[]): Buffer {
  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const plain = Buffer.from(entry.content ?? "", "utf-8");
    const method = entry.method ?? 0;
    const data = entry.data ?? (method === 8 ? deflateRawSync(plain) : plain);
    const crc = entry.crc ?? computeCrc32(plain);
    const size = entry.uncompressedSize ?? plain.length;
    const flags = entry.flags ?? 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    localFiles.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralDirectory.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centralDirectory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localFiles, directory, end]);
}

async function writeZip(
  fileName: string,
  entries: readonly RawZipEntry[],
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, buildZip(entries));
  return filePath;
}

function findRule(report: HealthReport, ruleId: string) {
  return report.findings.find((f) => f.ruleId === ruleId);
}

async function timed<T>(run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  expect(performance.now() - start).toBeLessThan(TIME_LIMIT_MS);
  return result;
}

function timedSync<T>(run: () => T): T {
  const start = performance.now();
  const result = run();
  expect(performance.now() - start).toBeLessThan(TIME_LIMIT_MS);
  return result;
}
