import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inspectEpubHealth,
  inspectPdfHealth,
  evaluateQualityGate,
  sortFindings,
  deduplicateFindings,
  RULE_REGISTRY,
  getRuleDefinition,
  type QualityFinding,
} from "../../packages/quality/src/index.js";
import { buildCanonicalEpubZip } from "../../packages/repair/src/rewriter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TEMP_DIR = path.resolve(__dirname, "../../scratch/quality-tests");

describe("Publication Quality Diagnostic Engine", () => {
  beforeEach(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe("Rule Registry", () => {
    it("has registered definitions for all expected standard rule IDs", () => {
      expect(RULE_REGISTRY.size).toBeGreaterThanOrEqual(25);
      expect(getRuleDefinition("EPUB-CONTAINER-001")).toBeDefined();
      expect(getRuleDefinition("EPUB-CONTAINER-001")?.defaultSeverity).toBe(
        "fatal",
      );
      expect(
        getRuleDefinition("EPUB-CONTAINER-001")?.defaultRepairability,
      ).toBe("safe-auto");
      expect(getRuleDefinition("PDF-TEXT-001")?.category).toBe("pdf-text");
    });
  });

  describe("EPUB Health Inspection", () => {
    it("reports 0 fatal or error findings on valid standard sample.epub", async () => {
      const samplePath = path.join(FIXTURES_DIR, "sample.epub");
      const report = await inspectEpubHealth(samplePath);

      expect(report.publicationType).toBe("epub");
      expect(report.summary.fatalCount).toBe(0);
      expect(report.summary.errorCount).toBe(0);
      expect(report.rulesExecuted.length).toBeGreaterThan(10);
    });

    it("reports 0 fatal or error findings on valid Japanese sample-japanese.epub", async () => {
      const samplePath = path.join(FIXTURES_DIR, "sample-japanese.epub");
      const report = await inspectEpubHealth(samplePath);

      expect(report.publicationType).toBe("epub");
      expect(report.summary.fatalCount).toBe(0);
      expect(report.summary.errorCount).toBe(0);
    });

    it("detects missing mimetype (EPUB-CONTAINER-001)", async () => {
      const brokenPath = path.join(TEMP_DIR, "missing-mimetype.epub");
      // Build raw zip without mimetype
      const entriesWithoutMimetype = [
        {
          name: "META-INF/container.xml",
          contents: Buffer.from(
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          ),
          isStored: true,
        },
        {
          name: "content.opf",
          contents: Buffer.from(
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from("<html><body><p>Hello</p></body></html>"),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
      ];

      // Custom zip building without mimetype entry
      const zipBuf = buildZipDirectly(entriesWithoutMimetype);
      await fs.writeFile(brokenPath, zipBuf);

      const report = await inspectEpubHealth(brokenPath);
      expect(report.summary.fatalCount).toBeGreaterThan(0);
      const rule = report.findings.find(
        (f) => f.ruleId === "EPUB-CONTAINER-001",
      );
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe("fatal");
      expect(rule?.repairability).toBe("safe-auto");
    });

    it("detects manifest item media-type mismatch (EPUB-MANIFEST-004)", async () => {
      const brokenEntries = [
        {
          name: "mimetype",
          contents: Buffer.from("application/epub+zip"),
          isStored: true,
        },
        {
          name: "META-INF/container.xml",
          contents: Buffer.from(
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          ),
        },
        {
          name: "content.opf",
          contents: Buffer.from(
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="text/plain"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from("<html><body><p>Chapter 1</p></body></html>"),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
      ];

      const brokenPath = path.join(TEMP_DIR, "mime-mismatch.epub");
      await fs.writeFile(brokenPath, buildCanonicalEpubZip(brokenEntries));

      const report = await inspectEpubHealth(brokenPath);
      const finding = report.findings.find(
        (f) => f.ruleId === "EPUB-MANIFEST-004",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("warning");
      expect(finding?.repairability).toBe("safe-auto");
      expect(
        finding?.evidence?.find((e) => e.key === "expectedMime")?.value,
      ).toBe("application/xhtml+xml");
    });

    it("detects unmanifested orphan resources in archive (EPUB-RESOURCE-001)", async () => {
      const brokenEntries = [
        {
          name: "mimetype",
          contents: Buffer.from("application/epub+zip"),
          isStored: true,
        },
        {
          name: "META-INF/container.xml",
          contents: Buffer.from(
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          ),
        },
        {
          name: "content.opf",
          contents: Buffer.from(
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from("<html><body><p>Chapter 1</p></body></html>"),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
        {
          name: "unreferenced-image.png",
          contents: Buffer.from("fake-png-bytes"),
        },
      ];

      const brokenPath = path.join(TEMP_DIR, "orphan.epub");
      await fs.writeFile(brokenPath, buildCanonicalEpubZip(brokenEntries));

      const report = await inspectEpubHealth(brokenPath);
      const orphanFinding = report.findings.find(
        (f) => f.ruleId === "EPUB-RESOURCE-001",
      );
      expect(orphanFinding).toBeDefined();
      expect(orphanFinding?.severity).toBe("info");
      expect(orphanFinding?.repairability).toBe("review-required");
      expect(orphanFinding?.location?.path).toBe("unreferenced-image.png");
    });

    it("detects security script violations (EPUB-SEC-002)", async () => {
      const entries = [
        {
          name: "mimetype",
          contents: Buffer.from("application/epub+zip"),
          isStored: true,
        },
        {
          name: "META-INF/container.xml",
          contents: Buffer.from(
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          ),
        },
        {
          name: "content.opf",
          contents: Buffer.from(
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from(
            '<html><body><script>alert("xss")</script><p>Hello</p></body></html>',
          ),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
      ];

      const brokenPath = path.join(TEMP_DIR, "script.epub");
      await fs.writeFile(brokenPath, buildCanonicalEpubZip(entries));

      const report = await inspectEpubHealth(brokenPath);
      const secFinding = report.findings.find(
        (f) => f.ruleId === "EPUB-SEC-002",
      );
      expect(secFinding).toBeDefined();
      expect(secFinding?.severity).toBe("warning");
    });
  });

  describe("PDF Health & Quality Gate", () => {
    it("inspects valid sample.pdf without fatal errors", async () => {
      const samplePdfPath = path.join(FIXTURES_DIR, "sample.pdf");
      const pdfBytes = await fs.readFile(samplePdfPath);
      const report = inspectPdfHealth(pdfBytes, "sample.pdf");

      expect(report.publicationType).toBe("pdf");
      expect(report.summary.fatalCount).toBe(0);
      expect(report.summary.errorCount).toBe(0);

      const gateResult = evaluateQualityGate(report, "baseline");
      expect(gateResult.passed).toBe(true);
      expect(gateResult.violations.length).toBe(0);
    });

    it("flags PDF-STRUCT-001 for invalid or corrupted PDF bytes", () => {
      const corruptBytes = Buffer.from("NOT_A_PDF_DOCUMENT");
      const report = inspectPdfHealth(corruptBytes, "corrupt.pdf");

      expect(report.summary.fatalCount).toBe(1);
      const fatalFinding = report.findings.find(
        (f) => f.ruleId === "PDF-STRUCT-001",
      );
      expect(fatalFinding).toBeDefined();

      const gateResult = evaluateQualityGate(report, "baseline");
      expect(gateResult.passed).toBe(false);
      expect(gateResult.violations.length).toBeGreaterThan(0);
    });
  });

  describe("Deduplication and Deterministic Sorting", () => {
    it("sorts findings by severity (fatal -> error -> warning -> info) then ruleId", () => {
      const findings: QualityFinding[] = [
        {
          ruleId: "EPUB-RESOURCE-001",
          severity: "info",
          category: "resource",
          message: "Info 1",
          repairability: "none",
        },
        {
          ruleId: "EPUB-CONTAINER-001",
          severity: "fatal",
          category: "container",
          message: "Fatal 1",
          repairability: "safe-auto",
        },
        {
          ruleId: "EPUB-MANIFEST-004",
          severity: "warning",
          category: "manifest",
          message: "Warning 1",
          repairability: "safe-auto",
        },
        {
          ruleId: "EPUB-MANIFEST-003",
          severity: "error",
          category: "manifest",
          message: "Error 1",
          repairability: "manual",
        },
      ];

      const sorted = sortFindings(findings);
      expect(sorted[0]?.ruleId).toBe("EPUB-CONTAINER-001");
      expect(sorted[1]?.ruleId).toBe("EPUB-MANIFEST-003");
      expect(sorted[2]?.ruleId).toBe("EPUB-MANIFEST-004");
      expect(sorted[3]?.ruleId).toBe("EPUB-RESOURCE-001");
    });

    it("deduplicates duplicate findings with the same ruleId, location, and message", () => {
      const findings: QualityFinding[] = [
        {
          ruleId: "EPUB-MANIFEST-004",
          severity: "warning",
          category: "manifest",
          message: "Duplicate message",
          location: { path: "opf" },
          repairability: "safe-auto",
        },
        {
          ruleId: "EPUB-MANIFEST-004",
          severity: "warning",
          category: "manifest",
          message: "Duplicate message",
          location: { path: "opf" },
          repairability: "safe-auto",
        },
      ];

      const deduped = deduplicateFindings(findings);
      expect(deduped.length).toBe(1);
    });
  });
});

function buildZipDirectly(
  entries: Array<{ name: string; contents: Buffer; isStored?: boolean }>,
): Buffer {
  // Simple zip builder without forcing mimetype first
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
