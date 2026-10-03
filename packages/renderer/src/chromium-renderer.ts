import type {
  NormalizedPublication,
  PdfDocument,
  Renderer,
  RenderOptions,
} from "@reflowpress/core";
import {
  resolveWritingMode,
  generateTypographyCss,
  normalizeLegacyEpubCss,
  applyTcyAssist,
} from "@reflowpress/typography";
import { chromium } from "playwright";

/**
 * Normalizes relative resource paths against a section's href.
 */
function resolveRelativePath(baseHref: string, relativeHref: string): string {
  if (relativeHref.startsWith("/")) {
    return relativeHref.slice(1);
  }
  const parts = baseHref.split("/");
  parts.pop(); // remove filename
  const segs = relativeHref.split("/");
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/**
 * Builds a lookup map from both full href and basename to Data URLs.
 */
function buildResourceDataUrlMap(
  resources: NormalizedPublication["resources"],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const res of resources) {
    const dataUrl = `data:${res.mediaType};base64,${Buffer.from(res.bytes).toString("base64")}`;
    map.set(res.href, dataUrl);
    // Also map by basename for resilient resolution
    const basename = res.href.split("/").pop();
    if (basename && !map.has(basename)) {
      map.set(basename, dataUrl);
    }
  }
  return map;
}

/**
 * Replaces image and asset references with inlined Base64 Data URLs.
 */
function inlineResources(
  html: string,
  sectionHref: string,
  resourceMap: Map<string, string>,
): string {
  // Replace <img ... src="..." ...>
  let inlined = html.replace(
    /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*?>)/gi,
    (match, p1, src, p3) => {
      if (
        src.startsWith("data:") ||
        src.startsWith("http://") ||
        src.startsWith("https://")
      ) {
        return match;
      }
      const resolved = resolveRelativePath(sectionHref, src);
      const dataUrl =
        resourceMap.get(resolved) ||
        resourceMap.get(src) ||
        resourceMap.get(src.split("/").pop() || "");
      if (dataUrl) {
        return `${p1}${dataUrl}${p3}`;
      }
      return match;
    },
  );

  // Replace <image ... href="..." or xlink:href="...">
  inlined = inlined.replace(
    /(<image\b[^>]*?\b(?:xlink:)?href=["'])([^"']+)(["'][^>]*?>)/gi,
    (match, p1, href, p3) => {
      if (
        href.startsWith("data:") ||
        href.startsWith("http://") ||
        href.startsWith("https://")
      ) {
        return match;
      }
      const resolved = resolveRelativePath(sectionHref, href);
      const dataUrl =
        resourceMap.get(resolved) ||
        resourceMap.get(href) ||
        resourceMap.get(href.split("/").pop() || "");
      if (dataUrl) {
        return `${p1}${dataUrl}${p3}`;
      }
      return match;
    },
  );

  return inlined;
}

/**
 * Strips script tags, event handlers, and unsafe elements for export safety.
 */
function sanitizeForPrint(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+=["'][^"']*["']/gi, "")
    .replace(/\s+href=["']javascript:[^"']*["']/gi, ' href="#"');
}

/**
 * Extracts inner body contents from a full HTML/XHTML document.
 */
function extractBodyContent(markup: string): string {
  const bodyMatch = markup.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1];
  }
  return markup;
}

/**
 * Headless Chromium-based PDF renderer utilizing Playwright and CSS Paged Media.
 */
export class ChromiumPdfRenderer implements Renderer {
  readonly id = "chromium";

  async render(
    publication: NormalizedPublication,
    options?: RenderOptions,
  ): Promise<PdfDocument> {
    const resourceMap = buildResourceDataUrlMap(publication.resources);

    // Collect and normalize embedded CSS stylesheets from resources
    const embeddedStyles: string[] = [];
    for (const res of publication.resources) {
      if (res.mediaType === "text/css") {
        const cssContent = new TextDecoder("utf-8").decode(res.bytes);
        embeddedStyles.push(normalizeLegacyEpubCss(cssContent));
      }
    }

    // Determine writing mode
    const firstSectionMarkup = publication.readingOrder[0]?.markup || "";
    const resolvedWritingMode = resolveWritingMode(
      options?.writingMode ?? "auto",
      {
        pageProgressionDirection:
          publication.metadata.direction === "rtl" ? "rtl" : undefined,
        renditionDirection:
          publication.metadata.direction === "rtl" ? "rtl" : undefined,
        markupSnippet: firstSectionMarkup.slice(0, 3000),
      },
    );

    // Generate core typography CSS
    const typographyCss = generateTypographyCss(
      {
        writingMode: resolvedWritingMode,
        lineBreak: "strict",
        tateChuYoko: "assist",
        rubyPosition: "auto",
      },
      {
        resolvedWritingMode,
        fontFamily:
          resolvedWritingMode === "vertical-rl"
            ? '"Noto Serif CJK JP", "Yu Mincho", "Hiragino Mincho ProN", serif'
            : "system-ui, -apple-system, sans-serif",
      },
    );

    // Page format and margins
    const pageSize = options?.pageSize ?? "A4";
    const margins =
      typeof options?.margin === "string"
        ? {
            top: options.margin,
            right: options.margin,
            bottom: options.margin,
            left: options.margin,
          }
        : {
            top: options?.margin?.top ?? "20mm",
            right: options?.margin?.right ?? "20mm",
            bottom: options?.margin?.bottom ?? "20mm",
            left: options?.margin?.left ?? "20mm",
          };

    const printCss = `
      @page {
        size: ${pageSize};
        margin: ${margins.top} ${margins.right} ${margins.bottom} ${margins.left};
      }
      @media print {
        *, *::before, *::after {
          box-sizing: border-box;
        }
        html, body {
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .reflowpress-print-section {
          break-before: page;
          page-break-before: always;
        }
        .reflowpress-print-section:first-of-type {
          break-before: avoid;
          page-break-before: avoid;
        }
        img, svg {
          max-width: 100%;
          page-break-inside: avoid;
          break-inside: avoid;
        }
      }
    `;

    // Assemble reading order sections
    const sectionHtmlParts: string[] = [];
    for (let i = 0; i < publication.readingOrder.length; i += 1) {
      const section = publication.readingOrder[i]!;
      let sectionBody = extractBodyContent(section.markup);

      // In vertical writing mode, apply TCY auto assist for 1-2 digit numbers
      if (resolvedWritingMode === "vertical-rl") {
        sectionBody = applyTcyAssist(sectionBody);
      }

      // Inline local images & assets
      sectionBody = inlineResources(sectionBody, section.href, resourceMap);

      // Sanitize
      sectionBody = sanitizeForPrint(sectionBody);

      sectionHtmlParts.push(`
        <article class="reflowpress-print-section" id="section-${i}-${section.id}">
          ${sectionBody}
        </article>
      `);
    }

    const docLang = publication.metadata.language || "ja";
    const docTitle = publication.metadata.title || "ReflowPress Publication";
    const dirAttr =
      publication.metadata.direction === "rtl" ? 'dir="rtl"' : 'dir="ltr"';

    const fullHtml = `<!DOCTYPE html>
<html lang="${docLang}" ${dirAttr}>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(docTitle)}</title>
  <style>
    ${typographyCss}
    ${embeddedStyles.join("\n")}
    ${printCss}
  </style>
</head>
<body class="reflowpress-export-body">
  ${sectionHtmlParts.join("\n")}
</body>
</html>`;

    // Launch headless Chromium via Playwright
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
      });
      const page = await context.newPage();

      // Block all network traffic (strictly offline)
      await page.route("**", (route) => route.abort());

      await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

      const isB5 = pageSize === "B5";
      const pdfBuffer = await page.pdf({
        ...(isB5 ? { width: "182mm", height: "257mm" } : { format: pageSize }),
        margin: margins,
        printBackground: true,
        landscape: options?.landscape ?? false,
      });

      await context.close();

      return {
        bytes: new Uint8Array(pdfBuffer),
        mediaType: "application/pdf",
      };
    } finally {
      await browser.close();
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
