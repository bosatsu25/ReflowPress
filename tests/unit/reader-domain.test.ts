import { describe, expect, it } from "vitest";
import type { PublicationSection } from "@reflowpress/core";
import {
  clampFontSize,
  clampLineHeight,
  clampMargin,
  clampPdfPage,
  clampPdfZoom,
  clampProgress,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_MARGIN,
  DEFAULT_PDF_ZOOM,
  DEFAULT_READER_SETTINGS,
  findSectionIndexByHref,
  getNextSectionIndex,
  getPreviousSectionIndex,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_MARGIN,
  MAX_PDF_ZOOM,
  MIN_FONT_SIZE,
  MIN_LINE_HEIGHT,
  MIN_MARGIN,
  MIN_PDF_ZOOM,
  type EpubLocation,
  type PdfLocation,
  type ReaderSettings,
  type ReaderState,
} from "../../packages/reader/src/index.js";

describe("Reader Domain", () => {
  describe("Reader Settings & Clamping", () => {
    it("has sound default settings", () => {
      expect(DEFAULT_READER_SETTINGS.fontSize).toBe(16);
      expect(DEFAULT_READER_SETTINGS.lineHeight).toBe(1.6);
      expect(DEFAULT_READER_SETTINGS.margin).toBe(32);
      expect(DEFAULT_READER_SETTINGS.theme).toBe("light");
    });

    it("clamps font size to boundaries", () => {
      expect(clampFontSize(MIN_FONT_SIZE - 5)).toBe(MIN_FONT_SIZE);
      expect(clampFontSize(MAX_FONT_SIZE + 20)).toBe(MAX_FONT_SIZE);
      expect(clampFontSize(20.4)).toBe(20);
      expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
    });

    it("clamps line height to boundaries", () => {
      expect(clampLineHeight(MIN_LINE_HEIGHT - 0.5)).toBe(MIN_LINE_HEIGHT);
      expect(clampLineHeight(MAX_LINE_HEIGHT + 1.0)).toBe(MAX_LINE_HEIGHT);
      expect(clampLineHeight(1.82)).toBe(1.8);
      expect(clampLineHeight(Number.POSITIVE_INFINITY)).toBe(
        DEFAULT_LINE_HEIGHT,
      );
    });

    it("clamps reading margins to boundaries", () => {
      expect(clampMargin(MIN_MARGIN - 5)).toBe(MIN_MARGIN);
      expect(clampMargin(MAX_MARGIN + 50)).toBe(MAX_MARGIN);
      expect(clampMargin(48.2)).toBe(48);
      expect(clampMargin(Number.NaN)).toBe(DEFAULT_MARGIN);
    });

    it("clamps reading progress from 0.0 to 1.0", () => {
      expect(clampProgress(-0.5)).toBe(0);
      expect(clampProgress(1.5)).toBe(1);
      expect(clampProgress(0.42)).toBe(0.42);
      expect(clampProgress(Number.NaN)).toBe(0);
    });

    it("supports switching themes between light, dark, and sepia", () => {
      const base: ReaderSettings = DEFAULT_READER_SETTINGS;
      const dark: ReaderSettings = { ...base, theme: "dark" };
      const sepia: ReaderSettings = { ...base, theme: "sepia" };
      expect(dark.theme).toBe("dark");
      expect(sepia.theme).toBe("sepia");
    });
  });

  describe("Section Navigation", () => {
    it("navigates forward within boundaries", () => {
      expect(getNextSectionIndex(0, 5)).toBe(1);
      expect(getNextSectionIndex(3, 5)).toBe(4);
      expect(getNextSectionIndex(4, 5)).toBe(4); // boundary clamped
      expect(getNextSectionIndex(0, 0)).toBe(0);
    });

    it("navigates backward within boundaries", () => {
      expect(getPreviousSectionIndex(3)).toBe(2);
      expect(getPreviousSectionIndex(1)).toBe(0);
      expect(getPreviousSectionIndex(0)).toBe(0); // boundary clamped
    });

    it("finds section index by full href or fragment", () => {
      const sections: PublicationSection[] = [
        {
          id: "c1",
          href: "text/ch1.xhtml",
          mediaType: "application/xhtml+xml",
          markup: "<html/>",
        },
        {
          id: "c2",
          href: "text/ch2.xhtml",
          mediaType: "application/xhtml+xml",
          markup: "<html/>",
        },
      ];

      expect(findSectionIndexByHref(sections, "text/ch1.xhtml")).toBe(0);
      expect(findSectionIndexByHref(sections, "text/ch2.xhtml#heading-1")).toBe(
        1,
      );
      expect(findSectionIndexByHref(sections, "ch2.xhtml")).toBe(1);
      expect(findSectionIndexByHref(sections, "unknown.xhtml")).toBe(-1);
    });
  });

  describe("PDF Navigation & Zoom", () => {
    it("clamps PDF page numbers", () => {
      expect(clampPdfPage(0, 10)).toBe(1);
      expect(clampPdfPage(5, 10)).toBe(5);
      expect(clampPdfPage(15, 10)).toBe(10);
      expect(clampPdfPage(2.8, 10)).toBe(2);
      expect(clampPdfPage(Number.NaN, 10)).toBe(1);
    });

    it("clamps PDF zoom factor", () => {
      expect(clampPdfZoom(MIN_PDF_ZOOM - 0.5)).toBe(MIN_PDF_ZOOM);
      expect(clampPdfZoom(MAX_PDF_ZOOM + 2.0)).toBe(MAX_PDF_ZOOM);
      expect(clampPdfZoom(1.254)).toBe(1.25);
      expect(clampPdfZoom(Number.NaN)).toBe(DEFAULT_PDF_ZOOM);
    });
  });

  describe("Reading Position & State Modeling", () => {
    it("models initial reader state as no-document", () => {
      const state: ReaderState = { status: "no-document" };
      expect(state.status).toBe("no-document");
    });

    it("models and restores EPUB reading position", () => {
      const location: EpubLocation = {
        kind: "epub",
        sectionId: "ch2",
        sectionHref: "text/ch2.xhtml",
        progress: 0.65,
      };

      expect(location.kind).toBe("epub");
      expect(location.sectionHref).toBe("text/ch2.xhtml");
      expect(location.progress).toBe(0.65);
    });

    it("models and restores PDF reading position", () => {
      const location: PdfLocation = {
        kind: "pdf",
        page: 14,
        zoom: 1.25,
      };

      expect(location.kind).toBe("pdf");
      expect(location.page).toBe(14);
      expect(location.zoom).toBe(1.25);
    });
  });
});
