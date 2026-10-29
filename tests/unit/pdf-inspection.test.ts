import { describe, it, expect } from "vitest";
import { inspectPdfBytes } from "../../packages/pdf/src/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("inspectPdfBytes page-count fallback", () => {
  it("reads /Count from the page tree when no page objects are found", () => {
    expect(
      inspectPdfBytes(
        bytes("%PDF-1.7\n1 0 obj << /Type /Pages /Kids [] /Count 7 >> endobj"),
      ).pageCount,
    ).toBe(7);
    expect(
      inspectPdfBytes(bytes("%PDF-1.7 /Type/Pages /Count x /Count 3"))
        .pageCount,
    ).toBe(3);
  });

  it("stays linear on many page-tree markers without a count", () => {
    // The previous lazy pattern took ~90 s on this input.
    const crafted = bytes("%PDF-1.7 " + "/Type/Pages ".repeat(200_000));
    const started = performance.now();
    expect(inspectPdfBytes(crafted).pageCount).toBe(0);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
