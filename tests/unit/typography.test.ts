import { describe, expect, it } from "vitest";
import {
  DEFAULT_JAPANESE_TYPOGRAPHY_SETTINGS,
  applyTcyAssist,
  calculateProgressionDelta,
  generateTypographyCss,
  normalizeLegacyEpubCss,
  removeTcySpans,
  resolveReadingFlow,
  resolveWritingMode,
} from "@reflowpress/typography";

describe("@reflowpress/typography Domain", () => {
  describe("Writing Mode and Reading Flow Resolution", () => {
    it("respects explicit writing mode selections over document context", () => {
      expect(
        resolveWritingMode("vertical-rl", {
          pageProgressionDirection: "ltr",
        }),
      ).toBe("vertical-rl");

      expect(
        resolveWritingMode("horizontal-tb", {
          pageProgressionDirection: "rtl",
        }),
      ).toBe("horizontal-tb");
    });

    it("resolves auto mode using EPUB 3 page-progression-direction and CSS metadata", () => {
      // Default auto with empty context defaults to horizontal
      expect(resolveWritingMode("auto")).toBe("horizontal-tb");

      // Japanese EPUB 3 vertical books use page-progression-direction="rtl"
      expect(
        resolveWritingMode("auto", { pageProgressionDirection: "rtl" }),
      ).toBe("vertical-rl");

      expect(resolveWritingMode("auto", { renditionDirection: "rtl" })).toBe(
        "vertical-rl",
      );

      expect(
        resolveWritingMode("auto", { cssWritingMode: "vertical-rl" }),
      ).toBe("vertical-rl");

      expect(
        resolveWritingMode("auto", {
          markupSnippet: '<body style="-epub-writing-mode: vertical-rl">',
        }),
      ).toBe("vertical-rl");
    });

    it("calculates progression direction and scroll deltas for horizontal and vertical flows", () => {
      const horizontalFlow = resolveReadingFlow("horizontal-tb");
      expect(horizontalFlow.axis).toBe("vertical");
      expect(horizontalFlow.progression).toBe("forward-positive");

      const hNext = calculateProgressionDelta(horizontalFlow, "next", {
        width: 800,
        height: 600,
      });
      expect(hNext.deltaX).toBe(0);
      expect(hNext.deltaY).toBeGreaterThan(0); // scrolls down

      const hPrev = calculateProgressionDelta(horizontalFlow, "previous", {
        width: 800,
        height: 600,
      });
      expect(hPrev.deltaX).toBe(0);
      expect(hPrev.deltaY).toBeLessThan(0); // scrolls up

      const verticalFlow = resolveReadingFlow("vertical-rl");
      expect(verticalFlow.axis).toBe("horizontal");
      expect(verticalFlow.progression).toBe("forward-negative");

      // In vertical-rl, forward progress moves columns to the left (negative X)
      const vNext = calculateProgressionDelta(verticalFlow, "next", {
        width: 800,
        height: 600,
      });
      expect(vNext.deltaX).toBeLessThan(0); // moves left
      expect(vNext.deltaY).toBe(0);

      const vPrev = calculateProgressionDelta(verticalFlow, "previous", {
        width: 800,
        height: 600,
      });
      expect(vPrev.deltaX).toBeGreaterThan(0); // moves right
      expect(vPrev.deltaY).toBe(0);
    });
  });

  describe("CSS Generation and Legacy Normalization", () => {
    it("normalizes legacy EPUB vendor prefixes into standards-based CSS", () => {
      const legacyCss = `
        body {
          -epub-writing-mode: vertical-rl;
          -epub-text-orientation: upright;
          -epub-line-break: strict;
        }
        .num {
          -epub-text-combine: horizontal;
        }
        rt {
          -epub-ruby-position: over;
        }
      `;

      const normalized = normalizeLegacyEpubCss(legacyCss);
      expect(normalized).toContain("writing-mode: vertical-rl;");
      expect(normalized).toContain("text-orientation: upright");
      expect(normalized).toContain("line-break: strict;");
      expect(normalized).toContain("text-combine-upright: all;");
      expect(normalized).toContain("ruby-position: over");
    });

    it("generates isolated typography stylesheet with writing modes, themes, ruby, and a11y", () => {
      const css = generateTypographyCss(
        {
          ...DEFAULT_JAPANESE_TYPOGRAPHY_SETTINGS,
          writingMode: "vertical-rl",
          lineBreak: "strict",
        },
        {
          theme: "sepia",
          fontSizePx: 18,
          lineHeight: 1.9,
          fontFamily: "Noto Serif JP",
        },
      );

      // Writing mode rules
      expect(css).toContain("writing-mode: vertical-rl !important;");
      expect(css).toContain("text-orientation: mixed !important;");

      // Theme rules
      expect(css).toContain("#fbf0d9"); // sepia bg
      expect(css).toContain("#3f2d18"); // sepia fg

      // Kinsoku rules
      expect(css).toContain("line-break: strict !important;");
      expect(css).toContain("word-break: normal !important;");

      // Ruby rules
      expect(css).toContain("ruby-position: over;");
      expect(css).toContain("user-select: none;");

      // TCY rules
      expect(css).toContain("text-combine-upright: all !important;");

      // Accessibility rules
      expect(css).toContain("@media (forced-colors: active)");
      expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    });
  });

  describe("Tate-Chu-Yoko (TCY) Assist Mode", () => {
    it("wraps 1-2 digit ASCII numerals in assist mode without corrupting text or tags", () => {
      const input =
        '<p class="c1">吾輩は猫である。第1章。昭和45年5月12日の出来事。西暦2024年の記録。</p>';

      const assisted = applyTcyAssist(input, "assist");

      // 1-2 digits should be wrapped
      expect(assisted).toContain('<span class="reflowpress-tcy">1</span>');
      expect(assisted).toContain('<span class="reflowpress-tcy">45</span>');
      expect(assisted).toContain('<span class="reflowpress-tcy">5</span>');
      expect(assisted).toContain('<span class="reflowpress-tcy">12</span>');

      // 4-digit number (2024) should NOT be wrapped
      expect(assisted).not.toContain(
        '<span class="reflowpress-tcy">2024</span>',
      );
      expect(assisted).toContain("2024年");

      // Tag attributes should not be affected
      expect(assisted).toContain('<p class="c1">');

      // Plain textContent without tags must be strictly preserved
      const plainOriginal = input.replace(/<[^>]+>/g, "");
      const plainAssisted = assisted.replace(/<[^>]+>/g, "");
      expect(plainAssisted).toBe(plainOriginal);
    });

    it("is idempotent and handles author and off modes safely", () => {
      const input = '<p>第<span class="reflowpress-tcy">1</span>章</p>';

      // Running assist on already assisted input does not duplicate wrappers
      const reAssisted = applyTcyAssist(input, "assist");
      expect(reAssisted).toBe(input);

      // Off mode strips reflowpress-tcy spans
      const stripped = applyTcyAssist(input, "off");
      expect(stripped).toBe("<p>第1章</p>");
      expect(removeTcySpans(input)).toBe("<p>第1章</p>");

      // Author mode preserves author HTML without adding assist wrappers
      const raw = "<p>昭和45年</p>";
      expect(applyTcyAssist(raw, "author")).toBe(raw);
    });
  });
});
