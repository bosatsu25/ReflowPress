import { describe, expect, it } from "vitest";
import type { NormalizedPublication } from "@reflowpress/core";
import { exportToPdf } from "@reflowpress/export";

describe("PDF Exporter", () => {
  const samplePublication: NormalizedPublication = {
    version: "3.0",
    metadata: {
      title: "PDF組版テスト",
      creator: "著者",
      language: "ja",
    },
    readingOrder: [
      {
        id: "p1",
        href: "page1.xhtml",
        mediaType: "application/xhtml+xml",
        markup: `
          <html xmlns="http://www.w3.org/1999/xhtml">
            <head><title>第1章</title></head>
            <body>
              <h1>第一章 日本語組版テスト</h1>
              <p>これはReflowPressのChromium PDFエクスポート機能の検証です。</p>
              <p><ruby>縦書き<rt>たてがき</rt></ruby>とルビの表示を確認します。</p>
            </body>
          </html>
        `,
      },
    ],
    resources: [],
  };

  it("renders a valid PDF with %PDF- header signature and positive page count", async () => {
    const result = await exportToPdf(samplePublication, {
      format: "pdf",
      pageSize: "A4",
      writingMode: "horizontal-tb",
    });

    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    const header = Buffer.from(result.bytes.slice(0, 5)).toString("ascii");
    expect(header).toBe("%PDF-");
    expect(result.pageCount).toBeGreaterThan(0);
  }, 30000);

  it("supports vertical writing mode and B5 page size", async () => {
    const result = await exportToPdf(samplePublication, {
      format: "pdf",
      pageSize: "B5",
      writingMode: "vertical-rl",
      margin: "15mm",
    });

    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    expect(result.pageCount).toBeGreaterThan(0);
  }, 30000);
});
