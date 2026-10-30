import type {
  NormalizedPublication,
  PdfDocument,
  Renderer,
  RenderOptions,
} from "@reflowpress/core";
import {
  resolveWritingMode,
  generateTypographyCss,
  applyTcyAssist,
} from "@reflowpress/typography";
import { chromium, type Browser } from "playwright";

/**
 * Environment variable that explicitly disables the Chromium sandbox.
 *
 * Chromium refuses to start sandboxed as root, and some CI containers lack the
 * user namespaces it needs. Such environments must opt out explicitly with
 * `REFLOWPRESS_CHROMIUM_NO_SANDBOX=1`; there is no silent fallback.
 */
export const CHROMIUM_NO_SANDBOX_ENV = "REFLOWPRESS_CHROMIUM_NO_SANDBOX";

/** Default timeout (ms) applied to browser launch, page.setContent and page.pdf. */
export const DEFAULT_RENDER_TIMEOUT_MS = 120_000;

const PRINT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";

export type RendererEnvironment = Readonly<Record<string, string | undefined>>;

/** True when the Chromium sandbox has been explicitly disabled via the environment. */
export function isChromiumSandboxOptOut(
  env: RendererEnvironment = process.env,
): boolean {
  const value = env[CHROMIUM_NO_SANDBOX_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export interface SanitizedPrintSection {
  /** Manifest id of the section; escaped by the renderer. */
  readonly id: string;
  /** Body markup that has ALREADY been sanitized by a DOM-based sanitizer. */
  readonly html: string;
}

export interface SanitizedPrintContent {
  readonly sections: readonly SanitizedPrintSection[];
  /** Stylesheets that have ALREADY been sanitized. */
  readonly stylesheets: readonly string[];
}

/**
 * Converts untrusted publication content into sanitized print content, e.g.
 * `sanitizePublicationContent` from `@reflowpress/export`.
 */
export type PrintContentSanitizer = (
  publication: NormalizedPublication,
) => SanitizedPrintContent;

export interface ChromiumPdfRendererOptions {
  /**
   * DOM-based sanitizer applied to every section before it reaches Chromium.
   * `render()` refuses to run without one, because publication markup is
   * attacker controlled.
   */
  readonly sanitizeContent?: PrintContentSanitizer | undefined;
  /** Timeout for launch, setContent and pdf (default: 120 s). */
  readonly timeoutMs?: number | undefined;
  /** Environment used for the sandbox opt-out (default: process.env). */
  readonly env?: RendererEnvironment | undefined;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Ensures embedded CSS can never close the surrounding <style> element. */
function neutralizeStyleText(css: string): string {
  return css.replace(/</g, "\\3c ");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface PrintDocument {
  readonly html: string;
  readonly pageSize: NonNullable<RenderOptions["pageSize"]>;
  readonly margins: {
    readonly top: string;
    readonly right: string;
    readonly bottom: string;
    readonly left: string;
  };
}

/**
 * Assembles the print HTML from already-sanitized content. Every value taken
 * from publication metadata or the manifest is escaped; all CSS is
 * neutralized so it cannot close the <style> element.
 */
export function buildPrintDocument(
  publication: NormalizedPublication,
  content: SanitizedPrintContent,
  options?: RenderOptions,
): PrintDocument {
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

  // Assemble reading order sections (already sanitized)
  const sectionHtmlParts: string[] = [];
  content.sections.forEach((section, index) => {
    let sectionBody = section.html;
    // In vertical writing mode, apply TCY handling on the sanitized markup
    if (resolvedWritingMode === "vertical-rl") {
      sectionBody = applyTcyAssist(sectionBody);
    }
    sectionHtmlParts.push(`
      <article class="reflowpress-print-section" id="section-${index}-${escapeHtml(section.id)}">
        ${sectionBody}
      </article>
    `);
  });

  const docLang = publication.metadata.language || "ja";
  const docTitle = publication.metadata.title || "ReflowPress Publication";
  const dirAttr =
    publication.metadata.direction === "rtl" ? 'dir="rtl"' : 'dir="ltr"';

  const styleText = neutralizeStyleText(
    [typographyCss, ...content.stylesheets, printCss].join("\n"),
  );

  const fullHtml = `<!DOCTYPE html>
<html lang="${escapeHtml(docLang)}" ${dirAttr}>
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="Content-Security-Policy" content="${PRINT_CONTENT_SECURITY_POLICY}"/>
  <title>${escapeHtml(docTitle)}</title>
  <style>
  ${styleText}
  </style>
</head>
<body class="reflowpress-export-body">
  ${sectionHtmlParts.join("\n")}
</body>
</html>`;

  return { html: fullHtml, pageSize, margins };
}

/**
 * Headless Chromium-based PDF renderer utilizing Playwright and CSS Paged Media.
 *
 * Security posture: content is sanitized before it reaches the browser (via the
 * injected `sanitizeContent`), JavaScript is disabled, the context is offline
 * with every request aborted, the document carries a strict CSP, the Chromium
 * sandbox is enabled unless explicitly disabled, and every browser step is
 * bounded by a timeout.
 */
export class ChromiumPdfRenderer implements Renderer {
  readonly id = "chromium";

  constructor(
    private readonly rendererOptions: ChromiumPdfRendererOptions = {},
  ) {}

  async render(
    publication: NormalizedPublication,
    options?: RenderOptions,
  ): Promise<PdfDocument> {
    const sanitizeContent = this.rendererOptions.sanitizeContent;
    if (!sanitizeContent) {
      throw new Error(
        "ChromiumPdfRenderer requires a DOM-based `sanitizeContent` function for untrusted publication content; use exportToPdf() from @reflowpress/export.",
      );
    }
    const content = sanitizeContent(publication);
    const {
      html: fullHtml,
      pageSize,
      margins,
    } = buildPrintDocument(publication, content, options);

    const timeoutMs =
      this.rendererOptions.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    const browser = await this.launchBrowser(timeoutMs);
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        offline: true,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      // Block all network traffic (strictly offline) for every page of the context
      await context.route("**", (route) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      await page.setContent(fullHtml, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });

      const isB5 = pageSize === "B5";
      // page.pdf() has no timeout option of its own; closing the browser in
      // `finally` aborts it when the race times out.
      const pdfBuffer = await withTimeout(
        page.pdf({
          ...(isB5
            ? { width: "182mm", height: "257mm" }
            : { format: pageSize }),
          margin: margins,
          printBackground: true,
          landscape: options?.landscape ?? false,
        }),
        timeoutMs,
        "Chromium PDF generation",
      );

      await context.close();

      return {
        bytes: new Uint8Array(pdfBuffer),
        mediaType: "application/pdf",
      };
    } finally {
      await browser.close();
    }
  }

  private async launchBrowser(timeoutMs: number): Promise<Browser> {
    const sandboxDisabled = isChromiumSandboxOptOut(
      this.rendererOptions.env ?? process.env,
    );
    try {
      return await chromium.launch({
        headless: true,
        chromiumSandbox: !sandboxDisabled,
        timeout: timeoutMs,
      });
    } catch (error) {
      if (sandboxDisabled) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to launch headless Chromium with its sandbox enabled (${reason.split("\n")[0]}). ` +
          `If this environment cannot provide the Chromium sandbox (for example when running as root or in a container without user namespaces), ` +
          `set ${CHROMIUM_NO_SANDBOX_ENV}=1 to explicitly disable it.`,
        { cause: error },
      );
    }
  }
}
