import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, EXIT_CODES } from "../../apps/cli/src/main.js";
import { buildCanonicalEpubZip } from "../../packages/repair/src/rewriter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TEMP_DIR = path.resolve(__dirname, "../../scratch/cli-quality-tests");

describe("CLI Quality & Safe Repair Subcommands", () => {
  const sampleEpub = path.join(FIXTURES_DIR, "sample.epub");
  const samplePdf = path.join(FIXTURES_DIR, "sample.pdf");

  beforeEach(async () => {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe("reflowpress inspect", () => {
    it("inspects a healthy EPUB with exit code 0", async () => {
      const stdoutLogs: string[] = [];
      const exitCode = await runCli(["inspect", sampleEpub], {
        stdout: (msg) => stdoutLogs.push(msg),
      });

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(stdoutLogs.join("\n")).toContain("Publication Health Report");
      expect(stdoutLogs.join("\n")).toContain("Fatal: 0, Error: 0");
    });

    it("outputs structured JSON when --json flag is provided", async () => {
      const stdoutLogs: string[] = [];
      const exitCode = await runCli(["inspect", sampleEpub, "--json"], {
        stdout: (msg) => stdoutLogs.push(msg),
      });

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      const parsed = JSON.parse(stdoutLogs.join(""));
      expect(parsed.publicationType).toBe("epub");
      expect(parsed.summary.totalFindings).toBeDefined();
    });

    it("inspects a PDF publication file", async () => {
      const stdoutLogs: string[] = [];
      const exitCode = await runCli(["inspect", samplePdf], {
        stdout: (msg) => stdoutLogs.push(msg),
      });

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(stdoutLogs.join("\n")).toContain("Type: PDF");
    });
  });

  describe("reflowpress validate", () => {
    it("validates PDF against baseline profile successfully", async () => {
      const stdoutLogs: string[] = [];
      const exitCode = await runCli(
        ["validate", samplePdf, "--profile", "baseline"],
        {
          stdout: (msg) => stdoutLogs.push(msg),
        },
      );

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(stdoutLogs.join("\n")).toContain("[PASS]");
    });
  });

  describe("reflowpress repair", () => {
    it("previews repairs in dry-run mode without modifying filesystem", async () => {
      // Create broken EPUB with mismatched media-type
      const brokenEpubPath = path.join(TEMP_DIR, "preview-broken.epub");
      const brokenBuffer = buildCanonicalEpubZip([
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
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="text/html"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from("<html><body><p>Text</p></body></html>"),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
      ]);
      await fs.writeFile(brokenEpubPath, brokenBuffer);

      const stdoutLogs: string[] = [];
      const exitCode = await runCli(["repair", brokenEpubPath], {
        stdout: (msg) => stdoutLogs.push(msg),
      });

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(stdoutLogs.join("\n")).toContain("Repair Preview (Dry Run)");
      expect(stdoutLogs.join("\n")).toContain(
        "Run with '--apply' to execute these repairs",
      );

      // Verify no repaired files were written
      const dirContents = await fs.readdir(TEMP_DIR);
      expect(dirContents.filter((f) => f.includes("_repaired_")).length).toBe(
        0,
      );
    });

    it("applies repairs with --apply and produces verified repaired file", async () => {
      const brokenEpubPath = path.join(TEMP_DIR, "apply-broken.epub");
      const brokenBuffer = buildCanonicalEpubZip([
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
            '<package version="3.0" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>en</dc:language><dc:identifier>id</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="text/html"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
          ),
        },
        {
          name: "c1.xhtml",
          contents: Buffer.from("<html><body><p>Text</p></body></html>"),
        },
        {
          name: "nav.xhtml",
          contents: Buffer.from(
            '<html><body><nav><ol><li><a href="c1.xhtml">C1</a></li></ol></nav></body></html>',
          ),
        },
      ]);
      await fs.writeFile(brokenEpubPath, brokenBuffer);

      const stdoutLogs: string[] = [];
      const exitCode = await runCli(
        [
          "repair",
          brokenEpubPath,
          "--apply",
          "--output-dir",
          TEMP_DIR,
          "--provenance",
        ],
        { stdout: (msg) => stdoutLogs.push(msg) },
      );

      expect(exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(stdoutLogs.join("\n")).toContain("Repaired publication created");

      const dirContents = await fs.readdir(TEMP_DIR);
      const repairedFile = dirContents.find(
        (f) => f.includes("_repaired_") && f.endsWith(".epub"),
      );
      expect(repairedFile).toBeDefined();

      const provenanceFile = dirContents.find((f) =>
        f.includes(".provenance.json"),
      );
      expect(provenanceFile).toBeDefined();
    });
  });
});
