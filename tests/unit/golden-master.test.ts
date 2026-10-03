import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEpub } from "@reflowpress/epub";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const GOLDEN_DIR = path.join(FIXTURES_DIR, "golden");

describe("3-Tier Golden Master Regression Framework", () => {
  describe("Tier 1: Structural Golden Assertions", () => {
    it("validates sample.epub structure against golden master JSON", async () => {
      const pub = await loadEpub(path.join(FIXTURES_DIR, "sample.epub"));
      const goldenRaw = await fs.readFile(
        path.join(GOLDEN_DIR, "sample-epub-structural.json"),
        "utf-8",
      );
      const golden = JSON.parse(goldenRaw);

      expect(pub.metadata.title).toBe(golden.title);
      expect(pub.metadata.language).toBe(golden.language);
      expect(pub.metadata.identifier).toBe(golden.identifier);
      expect(pub.readingOrder.length).toBe(golden.readingOrderCount);
      expect(pub.navigation?.length).toBe(golden.navigationCount);
    });

    it("validates sample-japanese.epub structure against golden master JSON", async () => {
      const pub = await loadEpub(
        path.join(FIXTURES_DIR, "sample-japanese.epub"),
      );
      const goldenRaw = await fs.readFile(
        path.join(GOLDEN_DIR, "sample-japanese-structural.json"),
        "utf-8",
      );
      const golden = JSON.parse(goldenRaw);

      expect(pub.metadata.title).toBe(golden.title);
      expect(pub.metadata.language).toBe(golden.language);
      expect(pub.metadata.direction).toBe(golden.direction);
      expect(pub.readingOrder.length).toBe(golden.readingOrderCount);
    });
  });

  describe("Tier 2: Textual Golden Assertions", () => {
    it("preserves Latin text content without corruption in sample.epub", async () => {
      const pub = await loadEpub(path.join(FIXTURES_DIR, "sample.epub"));
      const extractedText = pub.readingOrder
        .map((s) =>
          s.markup
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .join("\n");

      const goldenText = await fs.readFile(
        path.join(GOLDEN_DIR, "sample-epub-textual.txt"),
        "utf-8",
      );

      expect(extractedText).toBe(goldenText);
      expect(extractedText).not.toContain("\ufffd"); // No replacement characters
    });

    it("preserves Japanese kanji, hiragana, katakana, and ruby text in sample-japanese.epub", async () => {
      const pub = await loadEpub(
        path.join(FIXTURES_DIR, "sample-japanese.epub"),
      );
      const extractedText = pub.readingOrder
        .map((s) =>
          s.markup
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .join("\n");

      const goldenText = await fs.readFile(
        path.join(GOLDEN_DIR, "sample-japanese-textual.txt"),
        "utf-8",
      );

      expect(extractedText).toBe(goldenText);
      expect(extractedText).toContain("吾輩は猫である");
      expect(extractedText).toContain("アクセシビリティ");
      expect(extractedText).not.toContain("\ufffd"); // Zero Unicode replacement chars
    });
  });
});
