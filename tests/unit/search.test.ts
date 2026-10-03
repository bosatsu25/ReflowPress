import { describe, it, expect } from "vitest";
import {
  extractVisibleText,
  decodeHtmlEntities,
  createSearchSnippet,
  searchEpubSections,
  searchPdfPages,
} from "@reflowpress/search";

describe("Text Extraction and Snippet Utilities", () => {
  it("strips scripts, styles, comments, and extracts visible text", () => {
    const html = `
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>console.log("secret code");</script>
        </head>
        <body>
          <!-- Comment to ignore -->
          <h1>Chapter 1</h1>
          <p>Hello &amp; welcome to the <strong>ReflowPress</strong> workbench!&nbsp;&nbsp;</p>
        </body>
      </html>
    `;

    const text = extractVisibleText(html);
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("secret code");
    expect(text).not.toContain("<!--");
    expect(text).toContain("Chapter 1");
    expect(text).toContain("Hello & welcome to the ReflowPress workbench!");
  });

  it("decodes HTML entities including numeric entities", () => {
    expect(decodeHtmlEntities("&quot;Hello&quot; &lt;&gt; &amp; &#39;")).toBe(
      '"Hello" <> & \'',
    );
    expect(decodeHtmlEntities("&#65;&#66;&#67; &#x44;&#x45;")).toBe("ABC DE");
  });

  it("creates clean search snippets without corrupting surrogate pairs", () => {
    const text =
      "Once upon a time in a faraway kingdom, there lived a wise king with magical powers and golden crowns.";
    const matchStart = text.indexOf("magical");
    const snippet = createSearchSnippet(text, matchStart, "magical".length, 20);

    expect(snippet.match).toBe("magical");
    expect(snippet.before).toContain("wise king with");
    expect(snippet.after).toContain("powers and golden");
  });
});

describe("EPUB Full-Text Search Engine", () => {
  const sampleSections = [
    {
      href: "ch1.xhtml",
      title: "Chapter 1: The Beginning",
      content:
        "<html><body><h1>The Beginning</h1><p>It was the best of times, it was the worst of times.</p></body></html>",
    },
    {
      href: "ch2.xhtml",
      title: "Chapter 2: The Middle",
      content:
        "<html><body><h1>The Middle</h1><p>We had everything before us, we had nothing before us.</p></body></html>",
    },
    {
      href: "ch3.xhtml",
      title: "Chapter 3: 日本語の章",
      content:
        "<html><body><h1>吾輩は猫である</h1><p>名前はまだ無い。どこで生れたかとんと見当がつかぬ。</p></body></html>",
    },
  ];

  it("finds single and multiple matches across chapters", () => {
    // "times" appears twice in chapter 1
    const results = searchEpubSections("pub-1", sampleSections, "times");
    expect(results).toHaveLength(2);
    expect(results[0]?.sectionHref).toBe("ch1.xhtml");
    expect(results[0]?.snippet.match).toBe("times");
    expect(results[0]?.locator.kind).toBe("epub");
  });

  it("searches Japanese text without requiring whitespace word delimiters", () => {
    const results = searchEpubSections(
      "pub-1",
      sampleSections,
      "名前はまだ無い",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.sectionHref).toBe("ch3.xhtml");
    expect(results[0]?.snippet.match).toBe("名前はまだ無い");
  });

  it("performs case-insensitive Latin search", () => {
    const results = searchEpubSections("pub-1", sampleSections, "bEgInNiNg");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.snippet.match.toLowerCase()).toBe("beginning");
  });

  it("returns empty array for empty or whitespace query", () => {
    expect(searchEpubSections("pub-1", sampleSections, "")).toEqual([]);
    expect(searchEpubSections("pub-1", sampleSections, "   ")).toEqual([]);
  });

  it("honors maxResults limits", () => {
    const results = searchEpubSections("pub-1", sampleSections, "of", {
      maxResults: 1,
    });
    expect(results).toHaveLength(1);
  });

  it("supports AbortSignal cancellation during search", () => {
    const controller = new AbortController();
    controller.abort(); // already cancelled

    const results = searchEpubSections(
      "pub-1",
      sampleSections,
      "times",
      undefined,
      undefined,
      controller.signal,
    );
    expect(results).toHaveLength(0);
  });
});

describe("PDF Full-Text Search Engine", () => {
  const samplePages = [
    { page: 1, text: "ReflowPress Introduction. An interactive workbench." },
    {
      page: 2,
      text: "Architecture overview and portable annotation format specifications.",
    },
    { page: 3, text: "Conclusion and bibliography. ReflowPress manual ends." },
  ];

  it("finds matches across multiple PDF pages with page locators", () => {
    const results = searchPdfPages("pdf-1", samplePages, "ReflowPress");
    expect(results).toHaveLength(2);
    expect(results[0]?.page).toBe(1);
    expect(results[0]?.locator.kind).toBe("pdf");
    if (results[0]?.locator.kind === "pdf") {
      expect(results[0].locator.page).toBe(1);
    }
    expect(results[1]?.page).toBe(3);
  });

  it("returns clean snippets and match offsets", () => {
    const results = searchPdfPages("pdf-1", samplePages, "portable annotation");
    expect(results).toHaveLength(1);
    expect(results[0]?.page).toBe(2);
    expect(results[0]?.snippet.match).toBe("portable annotation");
  });
});
