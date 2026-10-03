import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  generateDeterministicFilename,
  sanitizeStem,
  ExportError,
} from "@reflowpress/export";

describe("Export Filename Generator", () => {
  describe("sanitizeStem", () => {
    it("preserves alphanumeric characters and dashes/underscores", () => {
      expect(sanitizeStem("My-Book_v1.0")).toBe("My-Book_v1.0");
    });

    it("preserves Unicode Japanese characters", () => {
      expect(sanitizeStem("吾輩は猫である-夏目漱石")).toBe(
        "吾輩は猫である-夏目漱石",
      );
    });

    it("replaces Windows and filesystem illegal characters with underscores", () => {
      expect(sanitizeStem('book:part1*chapter<2>?test"bar|baz')).toBe(
        "book_part1_chapter_2__test_bar_baz",
      );
    });

    it("trims forbidden leading and trailing dots and whitespace", () => {
      expect(sanitizeStem("  ...my-novel...   ")).toBe("my-novel");
    });

    it("falls back to 'publication' if entire stem is stripped", () => {
      expect(sanitizeStem("   ...???***   ")).toBe("publication");
    });
  });

  describe("formatTimestamp", () => {
    it("formats a Date into YYYYMMDD-HHmmss format", () => {
      const fixedDate = new Date(2026, 9, 3, 14, 5, 9); // Month index 9 = October
      expect(formatTimestamp(fixedDate)).toBe("20261003-140509");
    });
  });

  describe("generateDeterministicFilename", () => {
    const fixedClock = () => new Date(2026, 9, 3, 12, 0, 0);

    it("generates predictable PDF filename without collision", async () => {
      const res = await generateDeterministicFilename({
        sourcePath: "/path/to/my-novel.epub",
        format: "pdf",
        clock: fixedClock,
      });

      expect(res.filename).toBe("my-novel_20261003-120000.pdf");
      expect(res.assetDirectoryName).toBeUndefined();
    });

    it("generates predictable HTML filename", async () => {
      const res = await generateDeterministicFilename({
        sourcePath: "C:\\books\\夏目漱石.epub",
        format: "html",
        clock: fixedClock,
      });

      expect(res.filename).toBe("夏目漱石_20261003-120000.html");
      expect(res.assetDirectoryName).toBeUndefined();
    });

    it("generates Markdown filename with companion asset directory name", async () => {
      const res = await generateDeterministicFilename({
        sourcePath: "guide.epub",
        format: "markdown",
        clock: fixedClock,
      });

      expect(res.filename).toBe("guide_20261003-120000.md");
      expect(res.assetDirectoryName).toBe("guide_20261003-120000_assets");
    });

    it("resolves collision by appending -001, -002 when collision check returns true", async () => {
      const existing = new Set([
        "book_20261003-120000.pdf",
        "book_20261003-120000-001.pdf",
      ]);

      const res = await generateDeterministicFilename({
        sourcePath: "book.epub",
        format: "pdf",
        clock: fixedClock,
        isCollision: (candidate) => existing.has(candidate),
      });

      expect(res.filename).toBe("book_20261003-120000-002.pdf");
    });

    it("skips collision suffix when overwrite: true is requested", async () => {
      const existing = new Set(["book_20261003-120000.pdf"]);

      const res = await generateDeterministicFilename({
        sourcePath: "book.epub",
        format: "pdf",
        clock: fixedClock,
        overwrite: true,
        isCollision: (candidate) => existing.has(candidate),
      });

      expect(res.filename).toBe("book_20261003-120000.pdf");
    });

    it("throws ExportError OUTPUT_COLLISION_FAILED if collisions exceed 999", async () => {
      await expect(
        generateDeterministicFilename({
          sourcePath: "book.epub",
          format: "pdf",
          clock: fixedClock,
          isCollision: () => true, // always colliding
        }),
      ).rejects.toThrowError(ExportError);
    });
  });
});
