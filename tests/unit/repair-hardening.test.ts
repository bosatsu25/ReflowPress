import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { constants as zlibConstants, deflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openZipArchive, readEntryText } from "@reflowpress/epub";
import { inspectEpubHealth } from "../../packages/quality/src/index.js";
import {
  computeCrc32,
  executeRepair,
  planRepairs,
  type RepairPlan,
  type RepairResult,
} from "../../packages/repair/src/index.js";

const TIME_LIMIT_MS = 2000;
const MiB = 1024 * 1024;

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "reflowpress-repair-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("repair input limits", () => {
  it("aborts before decompressing an entry above the per-entry limit", async () => {
    // ~400 KB archive whose orphan entry declares (and inflates to) 400 MiB.
    // Previously every entry was read fully into memory.
    const sourcePath = await writeZip(
      "bomb.epub",
      brokenEpub([
        {
          name: "OEBPS/bomb.xhtml",
          method: 8,
          data: deflateBomb(400),
          uncompressedSize: 400 * MiB,
          crc: 0,
        },
      ]),
    );

    const result = await timedRepair(sourcePath);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OEBPS\/bomb\.xhtml.*per-entry limit/);
    await expectNoOutputs(["bomb.epub"]);
  });

  it("aborts when an entry inflates beyond its declared size", async () => {
    const sourcePath = await writeZip(
      "lying-bomb.epub",
      brokenEpub([
        {
          name: "OEBPS/bomb.xhtml",
          method: 8,
          data: deflateBomb(400),
          uncompressedSize: 100,
          crc: 0,
        },
      ]),
    );

    const result = await timedRepair(sourcePath);

    expect(result.success).toBe(false);
    expect(result.error).toContain("OEBPS/bomb.xhtml");
    await expectNoOutputs(["lying-bomb.epub"]);
  });

  it("aborts when the entries exceed the total uncompressed limit", async () => {
    const sourcePath = await writeZip("total.epub", brokenEpub());
    const plan = await planFor(sourcePath);

    const result = await executeRepair(sourcePath, plan, {
      outputDir: tempDir,
      limits: { maxTotalLoadedBytes: 600 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/total uncompressed size limit of 600/);
    await expectNoOutputs(["total.epub"]);
  });

  it("returns a failed result instead of throwing for unreadable sources", async () => {
    const plan: RepairPlan = {
      publicationPath: tempDir,
      actions: [
        {
          id: "action-canonical-mimetype",
          ruleId: "EPUB-CONTAINER-002",
          type: "canonical-mimetype",
          title: "t",
          description: "d",
          risk: "safe",
          targetFile: "mimetype",
        },
      ],
      safeActionCount: 1,
      reviewActionCount: 0,
      manualActionCount: 0,
    };

    for (const source of [tempDir, path.join(tempDir, "missing.epub")]) {
      const result = await executeRepair(source, plan, { outputDir: tempDir });
      expect(result.success).toBe(false);
      expect(result.preHealthReport.summary.fatalCount).toBeGreaterThan(0);
    }
    expect(await fs.readdir(tempDir)).toEqual([]);
  });
});

describe("repair output files", () => {
  it("refuses to overwrite an existing explicit output path", async () => {
    const sourcePath = await writeZip("book.epub", brokenEpub());
    const outputPath = path.join(tempDir, "out.epub");
    await fs.writeFile(outputPath, "precious");

    const result = await executeRepair(sourcePath, await planFor(sourcePath), {
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Refusing to overwrite existing file");
    expect(await fs.readFile(outputPath, "utf-8")).toBe("precious");
    await expectNoOutputs(["book.epub", "out.epub"]);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a symbolic link planted at the output path",
    async () => {
      const sourcePath = await writeZip("book.epub", brokenEpub());
      const victim = path.join(tempDir, "victim.txt");
      await fs.writeFile(victim, "precious");
      const outputPath = path.join(tempDir, "out.epub");
      await fs.symlink(victim, outputPath);

      const result = await executeRepair(
        sourcePath,
        await planFor(sourcePath),
        { outputPath },
      );

      expect(result.success).toBe(false);
      expect(await fs.readFile(victim, "utf-8")).toBe("precious");
      await expectNoOutputs(["book.epub", "out.epub", "victim.txt"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not write provenance through a planted symbolic link and withdraws the output",
    async () => {
      const sourcePath = await writeZip("book.epub", brokenEpub());
      const victim = path.join(tempDir, "victim.txt");
      await fs.writeFile(victim, "precious");
      const outputPath = path.join(tempDir, "out.epub");
      await fs.symlink(victim, `${outputPath}.provenance.json`);

      const result = await executeRepair(
        sourcePath,
        await planFor(sourcePath),
        { outputPath, writeProvenance: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("out.epub.provenance.json");
      expect(await fs.readFile(victim, "utf-8")).toBe("precious");
      await expect(fs.lstat(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expectNoOutputs([
        "book.epub",
        "out.epub.provenance.json",
        "victim.txt",
      ]);
    },
  );

  it("picks a non-colliding generated name instead of replacing a file", async () => {
    const sourcePath = await writeZip("book.epub", brokenEpub());
    const plan = await planFor(sourcePath);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
    const taken = path.join(tempDir, "book_repaired_20260102-030405.epub");
    await fs.writeFile(taken, "existing");

    const result = await executeRepair(sourcePath, plan, {
      outputDir: tempDir,
      writeProvenance: true,
    });

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(
      path.join(tempDir, "book_repaired_20260102-030405-2.epub"),
    );
    expect(await fs.readFile(taken, "utf-8")).toBe("existing");
    await fs.access(`${result.outputPath}.provenance.json`);
    expect((await fs.readdir(tempDir)).some((f) => f.includes(".tmp-"))).toBe(
      false,
    );
  });
});

describe("repair content rewriting", () => {
  it("escapes the OPF path when generating container.xml", async () => {
    const opfName = 'OEBPS/x" injected="&<1.opf';
    const entries = brokenEpub().filter(
      (e) => e.name !== "META-INF/container.xml" && e.name !== "mimetype",
    );
    const sourcePath = await writeZip(
      "no-container.epub",
      [{ name: "mimetype", content: "application/epub+zip" }, ...entries].map(
        (e) => (e.name === "OEBPS/content.opf" ? { ...e, name: opfName } : e),
      ),
    );
    const plan = await planFor(sourcePath);
    expect(plan.actions.some((a) => a.type === "container-xml")).toBe(true);

    const result = await executeRepair(sourcePath, plan, {
      outputDir: tempDir,
    });

    expect(result.success).toBe(true);
    const containerXml = await readZipText(
      result.outputPath!,
      "META-INF/container.xml",
    );
    const doc = new DOMParser().parseFromString(
      containerXml,
      "application/xml",
    );
    const rootfiles = doc.getElementsByTagName("rootfile");
    expect(rootfiles.length).toBe(1);
    expect(rootfiles[0]?.getAttribute("full-path")).toBe(opfName);
    expect(rootfiles[0]?.hasAttribute("injected")).toBe(false);
  });

  it("changes the media-type of the targeted manifest item only", async () => {
    const before =
      '<?xml version="1.0" encoding="UTF-8"?>\n<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>日本語の本</dc:title><dc:language>ja</dc:language><dc:identifier>id</dc:identifier></metadata><manifest>\n' +
      '  <!-- <item id="c1" href="c1.xhtml" media-type="text/plain"/> -->\n' +
      '  <item id="notes" href="notes.txt" media-type="text/plain"/>\n' +
      '  <item id="c1" href="c1.xhtml" ';
    const after =
      '/>\n  <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>\n</manifest><spine><itemref idref="c1"/></spine></package>';
    const opf = `${before}media-type='text/plain'${after}`;
    const sourcePath = await writeZip("mediatype.epub", [
      { name: "mimetype", content: "application/epub+zip" },
      ...brokenEpub()
        .filter((e) => e.name !== "mimetype")
        .map((e) =>
          e.name === "OEBPS/content.opf" ? { ...e, content: opf } : e,
        ),
      { name: "OEBPS/notes.txt", content: "notes" },
    ]);
    const plan = await planFor(sourcePath);
    expect(plan.actions.map((a) => a.type)).toEqual(["manifest-mediatype"]);

    const result = await executeRepair(sourcePath, plan, {
      outputDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.actionsApplied).toEqual([plan.actions[0]!.id]);
    const repairedOpf = await readZipText(
      result.outputPath!,
      "OEBPS/content.opf",
    );
    // Byte-for-byte identical apart from the targeted attribute value.
    expect(repairedOpf).toBe(
      `${before}media-type='application/xhtml+xml'${after}`,
    );
    const postReport = await inspectEpubHealth(result.outputPath!);
    expect(
      postReport.findings.find((f) => f.ruleId === "EPUB-MANIFEST-004"),
    ).toBeUndefined();
  });
});

interface RawZipEntry {
  readonly name: string;
  readonly content?: string;
  readonly data?: Buffer;
  readonly method?: number;
  readonly crc?: number;
  readonly uncompressedSize?: number;
}

/** A small EPUB with a safe-auto finding (wrong mimetype content). */
function brokenEpub(extra: readonly RawZipEntry[] = []): RawZipEntry[] {
  return [
    { name: "mimetype", content: "text/plain" },
    {
      name: "META-INF/container.xml",
      content:
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "OEBPS/content.opf",
      content:
        '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    },
    {
      name: "OEBPS/c1.xhtml",
      content: "<html><body><p>Chapter</p></body></html>",
    },
    {
      name: "OEBPS/nav.xhtml",
      content:
        '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
    },
    ...extra,
  ];
}

async function planFor(sourcePath: string): Promise<RepairPlan> {
  const report = await inspectEpubHealth(sourcePath);
  const { plan } = planRepairs(report);
  expect(plan.actions.length).toBeGreaterThan(0);
  return plan;
}

async function timedRepair(sourcePath: string): Promise<RepairResult> {
  const plan = await planFor(sourcePath);
  const start = performance.now();
  const result = await executeRepair(sourcePath, plan, {
    outputDir: tempDir,
    writeProvenance: true,
  });
  expect(performance.now() - start).toBeLessThan(TIME_LIMIT_MS);
  return result;
}

/** Asserts that the directory holds exactly the given files: no output or staging leftovers. */
async function expectNoOutputs(expected: readonly string[]): Promise<void> {
  expect((await fs.readdir(tempDir)).sort()).toEqual([...expected].sort());
}

async function readZipText(zipPath: string, entryName: string) {
  const { archive, entries } = await openZipArchive(
    zipPath,
    { maxArchiveBytes: 16 * MiB, maxEntries: 10_000 },
    (message) => new Error(message),
  );
  try {
    const entry = entries.get(entryName);
    if (!entry) throw new Error(`missing ${entryName}`);
    return await readEntryText(
      archive,
      entry,
      MiB,
      (message) => new Error(message),
    );
  } finally {
    archive.close();
  }
}

function deflateBomb(mebibytes: number): Buffer {
  const block = deflateRawSync(Buffer.alloc(MiB, 0x20), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  });
  const blocks: Buffer[] = new Array<Buffer>(mebibytes).fill(block);
  return Buffer.concat([...blocks, deflateRawSync(Buffer.alloc(0))]);
}

async function writeZip(
  fileName: string,
  entries: readonly RawZipEntry[],
): Promise<string> {
  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const plain = Buffer.from(entry.content ?? "", "utf-8");
    const method = entry.method ?? 0;
    const data = entry.data ?? plain;
    const crc = entry.crc ?? computeCrc32(plain);
    const size = entry.uncompressedSize ?? plain.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
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
    central.writeUInt16LE(0x0800, 8);
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

  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, Buffer.concat([...localFiles, directory, end]));
  return filePath;
}

describe("Review regressions: media-type repairs", () => {
  function opfWith(items: string): string {
    return `<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>${items}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
  }

  function epubWithOpf(
    opf: string,
    extra: readonly RawZipEntry[],
  ): RawZipEntry[] {
    return [
      { name: "mimetype", content: "application/epub+zip" },
      ...brokenEpub()
        .filter((e) => e.name !== "mimetype")
        .map((e) =>
          e.name === "OEBPS/content.opf" ? { ...e, content: opf } : e,
        ),
      ...extra,
    ];
  }

  it("applies many media-type fixes with a single scan of the OPF", async () => {
    const count = 4000;
    const items = Array.from(
      { length: count },
      (_, i) => `<item id="s${i}" href="s${i}.css" media-type="text/plain"/>`,
    ).join("");
    const css = Array.from({ length: count }, (_, i) => ({
      name: `OEBPS/s${i}.css`,
      content: "p{}",
    }));
    const sourcePath = await writeZip(
      "many.epub",
      epubWithOpf(opfWith(items), css),
    );
    const result = await timedRepair(sourcePath);
    expect(result.success).toBe(true);
    const repairedOpf = await readZipText(
      result.outputPath!,
      "OEBPS/content.opf",
    );
    expect(repairedOpf).toContain(
      '<item id="s0" href="s0.css" media-type="text/css"/>',
    );
  });

  it("leaves items with duplicate ids untouched", async () => {
    const sourcePath = await writeZip(
      "dupe.epub",
      epubWithOpf(
        opfWith(
          '<item id="x" href="a.css" media-type="text/plain"/><item id="x" href="b.js" media-type="text/plain"/>',
        ),
        [
          { name: "OEBPS/a.css", content: "p{}" },
          { name: "OEBPS/b.js", content: "" },
        ],
      ),
    );
    const report = await inspectEpubHealth(sourcePath);
    const { plan } = planRepairs(report);
    const result = await executeRepair(sourcePath, plan, {
      outputDir: tempDir,
    });
    expect(
      result.actionsApplied.some((id) =>
        plan.actions.some(
          (a) => a.id === id && a.type === "manifest-mediatype",
        ),
      ),
    ).toBe(false);
    if (result.outputPath) {
      const repairedOpf = await readZipText(
        result.outputPath,
        "OEBPS/content.opf",
      );
      expect(repairedOpf).not.toContain('href="b.js" media-type="text/css"');
    }
  });
});
