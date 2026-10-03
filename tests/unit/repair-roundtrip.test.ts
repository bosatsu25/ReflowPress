import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEpub } from "@reflowpress/epub";
import { inspectEpubHealth } from "../../packages/quality/src/index.js";
import { planRepairs, executeRepair } from "../../packages/repair/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, "../../scratch/repair-tests");

describe("Safe Repair Engine Roundtrip Verification", () => {
  beforeEach(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it("safely repairs broken mimetype and manifest media-type non-destructively", async () => {
    // 1. Create a broken EPUB with:
    //    a) Invalid mimetype content ('text/plain' instead of 'application/epub+zip') -> EPUB-CONTAINER-002
    //    b) Manifest item with mismatched media-type ('c1.xhtml' declared as 'text/html') -> EPUB-MANIFEST-004
    const brokenPath = path.join(TEMP_DIR, "broken-sample.epub");

    const entries = [
      {
        name: "mimetype",
        contents: Buffer.from("text/plain"), // WRONG
        isStored: true,
      },
      {
        name: "META-INF/container.xml",
        contents: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>',
        ),
      },
      {
        name: "OEBPS/content.opf",
        contents: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<package version="3.0" xmlns="http://www.idpf.org/2007/opf">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>Repair Roundtrip Test Book</dc:title>\n    <dc:language>en</dc:language>\n    <dc:identifier>urn:uuid:test-repair-1</dc:identifier>\n  </metadata>\n  <manifest>\n    <item id="c1" href="c1.xhtml" media-type="text/html"/>\n    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine>\n    <itemref idref="c1"/>\n  </spine>\n</package>',
        ),
      },
      {
        name: "OEBPS/c1.xhtml",
        contents: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title>Chapter 1</title></head>\n<body><h1>Chapter 1</h1><p>Test paragraph content for roundtrip inspection.</p></body>\n</html>',
        ),
      },
      {
        name: "OEBPS/nav.xhtml",
        contents: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n<head><title>TOC</title></head>\n<body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Chapter 1</a></li></ol></nav></body>\n</html>',
        ),
      },
    ];

    await fs.writeFile(brokenPath, buildDirectZip(entries));
    const originalBytes = await fs.readFile(brokenPath);
    const originalSha256 = sha256(originalBytes);

    // 2. Pre-repair inspection: assert findings are detected
    const preReport = await inspectEpubHealth(brokenPath);
    expect(preReport.summary.totalFindings).toBeGreaterThan(0);
    const mimeFinding = preReport.findings.find(
      (f) => f.ruleId === "EPUB-CONTAINER-002",
    );
    expect(mimeFinding).toBeDefined();
    const manifestFinding = preReport.findings.find(
      (f) => f.ruleId === "EPUB-MANIFEST-004",
    );
    expect(manifestFinding).toBeDefined();

    // 3. Plan repairs: assert safe actions planned
    const { plan, preview } = planRepairs(preReport);
    expect(plan.safeActionCount).toBeGreaterThanOrEqual(2);
    expect(preview.diffs.length).toBeGreaterThanOrEqual(2);

    // 4. Execute repair non-destructively
    const repairResult = await executeRepair(brokenPath, plan, {
      outputDir: TEMP_DIR,
      writeProvenance: true,
    });

    expect(repairResult.success).toBe(true);
    expect(repairResult.outputPath).toBeDefined();
    expect(repairResult.outputPath).not.toBe(brokenPath);

    // 5. Non-destructive principle: original file is 100% untouched
    const afterOriginalBytes = await fs.readFile(brokenPath);
    expect(sha256(afterOriginalBytes)).toBe(originalSha256);

    // 6. Repaired file verification: target findings are resolved
    const repairedPath = repairResult.outputPath!;
    const postReport = await inspectEpubHealth(repairedPath);
    expect(postReport.summary.fatalCount).toBe(0);
    expect(postReport.summary.errorCount).toBe(0);
    expect(
      postReport.findings.find((f) => f.ruleId === "EPUB-CONTAINER-002"),
    ).toBeUndefined();
    expect(
      postReport.findings.find((f) => f.ruleId === "EPUB-MANIFEST-004"),
    ).toBeUndefined();

    // 7. Loadable with publication core (@reflowpress/epub loadEpub)
    const publication = await loadEpub(repairedPath);
    expect(publication.metadata.title).toBe("Repair Roundtrip Test Book");
    expect(publication.readingOrder.length).toBe(1);
    expect(publication.readingOrder[0]?.id).toBe("c1");

    // 8. Provenance manifest sidecar exists and has correct hashes
    const provenancePath = `${repairedPath}.provenance.json`;
    const provenanceRaw = await fs.readFile(provenancePath, "utf-8");
    const provenance = JSON.parse(provenanceRaw);
    expect(provenance.sourceSha256).toBe(originalSha256);
    expect(provenance.outputSha256).toBe(
      sha256(await fs.readFile(repairedPath)),
    );
    expect(provenance.appliedRuleIds).toContain("EPUB-CONTAINER-002");
    expect(provenance.appliedRuleIds).toContain("EPUB-MANIFEST-004");
  });
});

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function buildDirectZip(
  entries: Array<{ name: string; contents: Buffer; isStored?: boolean }>,
): Buffer {
  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const contents = entry.contents;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8); // Store
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);

    localFiles.push(localHeader, nameBytes, contents);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralDirectory.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + contents.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirectory);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirBuffer.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localFiles, centralDirBuffer, endRecord]);
}
