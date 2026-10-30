import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  extractVisibleText,
  searchEpubSections,
} from "@reflowpress/search";

function timed(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe("Visible text extraction is linear (no ReDoS)", () => {
  // Each input previously triggered quadratic backtracking in
  // <script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>, the style twin,
  // <!--[\s\S]*?--> or <[^>]+> (180 KB took ~3.5 s on the UI thread).
  const pathological: Record<string, string> = {
    "unclosed <script> with long body": `<script>${"a<b".repeat(60000)}`,
    "many unclosed <script openers": "<script".repeat(50000),
    "many unclosed <style openers": "<style>x".repeat(40000),
    "many unclosed comments": "<!--".repeat(60000),
    "comments with stray >": "<!-- >".repeat(40000),
    "lone < characters": "<".repeat(250000),
    "script closer without >": `${"<script>".repeat(30000)}</script`,
    "mixed openers": "<script <style <!-- <a ".repeat(20000),
  };

  for (const [name, input] of Object.entries(pathological)) {
    it(`handles ${name} (${Math.round(input.length / 1024)} KB) quickly`, () => {
      expect(timed(() => extractVisibleText(input))).toBeLessThan(2000);
    });
  }

  it("searches a hostile section without stalling", () => {
    const content = `<html><body><p>needle</p>${"<script".repeat(50000)}</body></html>`;
    let results: ReturnType<typeof searchEpubSections> = [];
    const duration = timed(() => {
      results = searchEpubSections(
        "pub",
        [{ href: "a.xhtml", content }],
        "needle",
      );
    });
    expect(duration).toBeLessThan(2000);
    expect(results).toHaveLength(1);
  });
});

describe("Visible text extraction semantics", () => {
  it("removes script/style content including closing tags with whitespace", () => {
    const text = extractVisibleText(
      `<p>a</p><script type="x">secret()</script ><STYLE>p{}</STYLE>b<!-- hidden -->c`,
    );
    expect(text).not.toContain("secret");
    expect(text).not.toContain("p{}");
    expect(text).not.toContain("hidden");
    expect(text).toBe("a b c");
  });

  it("keeps text after unclosed constructs like the previous implementation", () => {
    expect(extractVisibleText("<script>alert(1)")).toBe("alert(1)");
    expect(extractVisibleText("a < b and c")).toBe("a < b and c");
    expect(extractVisibleText("x <> y")).toBe("x <> y");
    expect(extractVisibleText("<!-- open <b>bold</b>")).toBe("bold");
    expect(extractVisibleText("<scripts>kept</scripts>")).toBe("kept");
  });

  it("separates block-level elements and decodes entities once", () => {
    expect(extractVisibleText("<h1>Title</h1><p>One</p><p>Two</p>")).toBe(
      "Title One Two",
    );
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeHtmlEntities("&#x1F600;&#65;&nbsp;&quot;")).toBe('😀A "');
    expect(decodeHtmlEntities("&#x110000;")).toBe("");
  });
});
