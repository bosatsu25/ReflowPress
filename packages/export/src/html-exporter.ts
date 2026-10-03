import type { NormalizedPublication } from "@reflowpress/core";
import {
  resolveWritingMode,
  generateTypographyCss,
  normalizeLegacyEpubCss,
  applyTcyAssist,
} from "@reflowpress/typography";
import type { ExportWritingMode } from "./models.js";

export interface HtmlExportOptions {
  readonly writingMode?: ExportWritingMode | undefined;
  readonly maxInlineAssetBytes?: number | undefined; // default: 16 MiB
}

export interface HtmlExportResult {
  readonly html: string;
  readonly warnings: readonly string[];
}

function resolveRelativePath(baseHref: string, relativeHref: string): string {
  if (relativeHref.startsWith("/")) {
    return relativeHref.slice(1);
  }
  const parts = baseHref.split("/");
  parts.pop();
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

function buildResourceDataMap(
  resources: NormalizedPublication["resources"],
  maxTotalBytes: number,
): { map: Map<string, string>; warnings: string[] } {
  const map = new Map<string, string>();
  const warnings: string[] = [];
  let currentBytes = 0;

  for (const res of resources) {
    if (currentBytes + res.bytes.length > maxTotalBytes) {
      warnings.push(
        `Asset '${res.href}' (${res.bytes.length} bytes) was omitted from inlining because the maximum threshold (${maxTotalBytes} bytes) was reached.`,
      );
      continue;
    }

    const dataUrl = `data:${res.mediaType};base64,${Buffer.from(res.bytes).toString("base64")}`;
    map.set(res.href, dataUrl);
    const base = res.href.split("/").pop();
    if (base && !map.has(base)) {
      map.set(base, dataUrl);
    }
    currentBytes += res.bytes.length;
  }

  return { map, warnings };
}

function inlineHtmlResources(
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

function sanitizeExportHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+=["'][^"']*["']/gi, "")
    .replace(/\s+href=["']javascript:[^"']*["']/gi, ' href="#"');
}

function extractBody(markup: string): string {
  const match = markup.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match && match[1] ? match[1] : markup;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Exports a NormalizedPublication into a single, self-contained standalone HTML5 document.
 */
export function exportToHtml(
  publication: NormalizedPublication,
  options?: HtmlExportOptions,
): HtmlExportResult {
  const allWarnings: string[] = [];
  const maxBytes = options?.maxInlineAssetBytes ?? 16 * 1024 * 1024;
  const { map: resourceMap, warnings: assetWarnings } = buildResourceDataMap(
    publication.resources,
    maxBytes,
  );
  allWarnings.push(...assetWarnings);

  // Collect embedded CSS
  const embeddedCss: string[] = [];
  for (const res of publication.resources) {
    if (res.mediaType === "text/css") {
      const cssStr = new TextDecoder("utf-8").decode(res.bytes);
      embeddedCss.push(normalizeLegacyEpubCss(cssStr));
    }
  }

  // Determine writing mode
  const firstMarkup = publication.readingOrder[0]?.markup || "";
  const resolvedWritingMode = resolveWritingMode(
    options?.writingMode ?? "auto",
    {
      pageProgressionDirection:
        publication.metadata.direction === "rtl" ? "rtl" : undefined,
      renditionDirection:
        publication.metadata.direction === "rtl" ? "rtl" : undefined,
      markupSnippet: firstMarkup.slice(0, 3000),
    },
  );

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

  const sectionsHtml: string[] = [];
  for (let i = 0; i < publication.readingOrder.length; i += 1) {
    const sec = publication.readingOrder[i]!;
    let body = extractBody(sec.markup);

    if (resolvedWritingMode === "vertical-rl") {
      body = applyTcyAssist(body);
    }

    body = inlineHtmlResources(body, sec.href, resourceMap);
    body = sanitizeExportHtml(body);

    sectionsHtml.push(`
      <article class="reflowpress-section" id="section-${i}-${sec.id}" data-href="${escapeHtml(sec.href)}">
        ${body}
      </article>
    `);
  }

  const docLang = publication.metadata.language || "ja";
  const docTitle = publication.metadata.title || "ReflowPress Publication";
  const creator =
    typeof publication.metadata.creator === "string"
      ? publication.metadata.creator
      : Array.isArray(publication.metadata.creator)
        ? publication.metadata.creator.join(", ")
        : "";
  const dirAttr =
    publication.metadata.direction === "rtl" ? 'dir="rtl"' : 'dir="ltr"';

  const standaloneHtml = `<!DOCTYPE html>
<html lang="${escapeHtml(docLang)}" ${dirAttr}>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="generator" content="ReflowPress Export Workbench"/>
  ${creator ? `<meta name="author" content="${escapeHtml(creator)}"/>` : ""}
  <title>${escapeHtml(docTitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    ${typographyCss}
    ${embeddedCss.join("\n")}
    .reflowpress-section {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #e5e7eb;
    }
    .reflowpress-section:last-of-type {
      border-bottom: none;
    }
  </style>
</head>
<body class="reflowpress-standalone-html">
  <header class="reflowpress-pub-header" style="margin-bottom: 2rem;">
    <h1>${escapeHtml(docTitle)}</h1>
    ${creator ? `<p class="reflowpress-pub-author"><em>${escapeHtml(creator)}</em></p>` : ""}
  </header>
  <main>
    ${sectionsHtml.join("\n")}
  </main>
</body>
</html>`;

  return {
    html: standaloneHtml,
    warnings: allWarnings,
  };
}
