import { describe, expect, it } from "vitest";
import type { NormalizedPublication } from "@reflowpress/core";
import { exportToHtml } from "@reflowpress/export";

describe("HTML Exporter", () => {
  const dummyPublication: NormalizedPublication = {
    version: "3.0",
    metadata: {
      title: "テスト小説",
      creator: "著者名",
      language: "ja",
      direction: "rtl",
    },
    readingOrder: [
      {
        id: "sec1",
        href: "text/ch1.xhtml",
        mediaType: "application/xhtml+xml",
        markup: `
          <html xmlns="http://www.w3.org/1999/xhtml">
            <head><title>第一章</title></head>
            <body>
              <section>
                <h1>第一章 旅立ち</h1>
                <p>吾輩は猫である。<script>alert("evil")</script></p>
                <img src="../images/cover.png" alt="表紙" onclick="evil()" />
              </section>
            </body>
          </html>
        `,
      },
    ],
    resources: [
      {
        href: "images/cover.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      },
    ],
  };

  it("exports a single self-contained standalone HTML document", async () => {
    const result = await exportToHtml(dummyPublication);

    expect(result.html).toContain("<!DOCTYPE html>");
    expect(result.html).toContain('<html lang="ja"');
    expect(result.html).toContain("<title>テスト小説</title>");
    expect(result.html).toContain("第一章 旅立ち");
    expect(result.html).toContain("吾輩は猫である。");
  });

  it("inlines images as base64 Data URLs", async () => {
    const result = await exportToHtml(dummyPublication);

    expect(result.html).toContain('src="data:image/png;base64,iVBORw0KGgo=');
    expect(result.html).not.toContain("../images/cover.png");
  });

  it("strips scripts and javascript: event attributes for security", async () => {
    const result = await exportToHtml(dummyPublication);

    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("alert(");
    expect(result.html).not.toContain("onclick=");
  });

  it("applies Japanese typography CSS and writing mode", async () => {
    const result = await exportToHtml(dummyPublication, {
      writingMode: "vertical-rl",
    });

    expect(result.html).toContain("writing-mode: vertical-rl");
    expect(result.html).toContain("line-break: strict");
  });
});
