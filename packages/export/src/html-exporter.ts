import type { NormalizedPublication } from "@reflowpress/core";
import {
  resolveWritingMode,
  generateTypographyCss,
  applyTcyAssist,
} from "@reflowpress/typography";
import type { ExportWritingMode } from "./models.js";
import {
  DEFAULT_MAX_INLINE_ASSET_BYTES,
  EXPORT_CONTENT_SECURITY_POLICY,
  escapeHtml,
  neutralizeStyleText,
  sanitizePublicationContent,
} from "./sanitizer.js";

export interface HtmlExportOptions {
  readonly writingMode?: ExportWritingMode | undefined;
  /**
   * Maximum number of asset bytes inlined as data: URLs (default: 16 MiB).
   * Every inlined occurrence counts, so a large image referenced many times
   * cannot multiply the document size beyond this budget.
   */
  readonly maxInlineAssetBytes?: number | undefined;
}

export interface HtmlExportResult {
  readonly html: string;
  readonly warnings: readonly string[];
}

/**
 * Exports a NormalizedPublication into a single, self-contained standalone HTML5 document.
 *
 * All section markup and stylesheets pass the shared DOM allowlist sanitizer
 * (see sanitizer.ts); the document additionally carries a strict CSP that
 * forbids script and any network access.
 */
export function exportToHtml(
  publication: NormalizedPublication,
  options?: HtmlExportOptions,
): HtmlExportResult {
  const sanitized = sanitizePublicationContent(publication, {
    maxInlineAssetBytes:
      options?.maxInlineAssetBytes ?? DEFAULT_MAX_INLINE_ASSET_BYTES,
  });

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
  sanitized.sections.forEach((section, index) => {
    let body = section.html;
    if (resolvedWritingMode === "vertical-rl") {
      // Operates on sanitized markup: every tag is closed and text is escaped.
      body = applyTcyAssist(body);
    }

    sectionsHtml.push(`
      <article class="reflowpress-section" id="section-${index}-${escapeHtml(section.id)}" data-href="${escapeHtml(section.href)}">
        ${body}
      </article>
    `);
  });

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

  const styleText = neutralizeStyleText(
    [
      "*, *::before, *::after { box-sizing: border-box; }",
      typographyCss,
      ...sanitized.stylesheets,
      `.reflowpress-section {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #e5e7eb;
    }
    .reflowpress-section:last-of-type {
      border-bottom: none;
    }`,
    ].join("\n"),
  );

  const standaloneHtml = `<!DOCTYPE html>
<html lang="${escapeHtml(docLang)}" ${dirAttr}>
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="Content-Security-Policy" content="${EXPORT_CONTENT_SECURITY_POLICY}"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="generator" content="ReflowPress Export Workbench"/>
  ${creator ? `<meta name="author" content="${escapeHtml(creator)}"/>` : ""}
  <title>${escapeHtml(docTitle)}</title>
  <style>
    ${styleText}
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
    warnings: sanitized.warnings,
  };
}
