import { describe, expect, it } from "vitest";
import type { NormalizedPublication } from "@reflowpress/core";
import { exportToMarkdown } from "@reflowpress/export";

describe("Markdown Exporter", () => {
  const dummyPublication: NormalizedPublication = {
    version: "3.0",
    metadata: {
      title: "吾輩は猫である",
      creator: "夏目漱石",
      language: "ja",
    },
    readingOrder: [
      {
        id: "ch1",
        href: "text/ch1.xhtml",
        mediaType: "application/xhtml+xml",
        markup: `
          <html xmlns="http://www.w3.org/1999/xhtml">
            <body>
              <h1>第一章</h1>
              <p><ruby>吾輩<rt>わがはい</rt></ruby>は猫である。名前はまだ無い。</p>
              <p>作者は<ruby>夏目<rt>なつめ</rt>漱石<rt>そうせき</rt></ruby>。</p>
              <blockquote>人間というものは、贅沢な動物だ。</blockquote>
              <ul>
                <li>第一条</li>
                <li>第二条</li>
              </ul>
              <table>
                <tr><th>項目</th><th>値</th></tr>
                <tr><td>名前</td><td>名無し</td></tr>
              </table>
              <img src="../images/cat.png" alt="猫のイラスト" />
              <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mi>y</mi></math>
            </body>
          </html>
        `,
      },
    ],
    resources: [
      {
        href: "images/cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ],
  };

  it("produces standard YAML frontmatter with publication metadata", () => {
    const result = exportToMarkdown(dummyPublication);

    expect(result.markdown).toContain("---");
    expect(result.markdown).toContain('title: "吾輩は猫である"');
    expect(result.markdown).toContain('author: "夏目漱石"');
    expect(result.markdown).toContain('language: "ja"');
    expect(result.markdown).toContain(
      'generator: "ReflowPress Export Workbench"',
    );
  });

  it("converts HTML ruby markup to base（reading） text representation", () => {
    const result = exportToMarkdown(dummyPublication);

    expect(result.markdown).toContain(
      "吾輩（わがはい）は猫である。名前はまだ無い。",
    );
    expect(result.markdown).toContain("夏目（なつめ）漱石（そうせき）");
  });

  it("converts HTML tables to GitHub-Flavored Markdown tables", () => {
    const result = exportToMarkdown(dummyPublication);

    expect(result.markdown).toContain("| 項目 | 値 |");
    expect(result.markdown).toContain("| --- | --- |");
    expect(result.markdown).toContain("| 名前 | 名無し |");
  });

  it("extracts companion image assets and updates markdown image links", () => {
    const result = exportToMarkdown(dummyPublication, {
      assetDirectoryName: "book_assets",
    });

    expect(result.markdown).toContain("![猫のイラスト](book_assets/cat.png)");
    expect(result.assets.has("cat.png")).toBe(true);
    expect(result.assets.get("cat.png")).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("preserves MathML notation with an informative warning", () => {
    const result = exportToMarkdown(dummyPublication);

    expect(result.markdown).toContain("<math");
    expect(result.warnings.some((w) => w.includes("MathML"))).toBe(true);
  });
});
