import type { NormalizedPublication } from "@reflowpress/core";
import {
  ChromiumPdfRenderer,
  CHROMIUM_NO_SANDBOX_ENV,
  isChromiumSandboxOptOut,
} from "@reflowpress/renderer";
import { BaselinePdfValidator } from "@reflowpress/validation";
import { ExportError, type ExportOptions } from "./models.js";
import { sanitizePublicationContent } from "./sanitizer.js";

export interface PdfExportResult {
  readonly bytes: Uint8Array;
  readonly pageCount?: number | undefined;
  readonly warnings: readonly string[];
}

export async function exportToPdf(
  publication: NormalizedPublication,
  options: ExportOptions,
): Promise<PdfExportResult> {
  const warnings: string[] = [];

  if (isChromiumSandboxOptOut()) {
    warnings.push(
      `Chromium sandbox disabled by ${CHROMIUM_NO_SANDBOX_ENV}; the PDF renderer runs without OS-level isolation.`,
    );
  }

  // The renderer only ever receives markup produced by the shared DOM sanitizer.
  const renderer = new ChromiumPdfRenderer({
    sanitizeContent: (pub) => {
      const sanitized = sanitizePublicationContent(pub);
      warnings.push(...sanitized.warnings);
      return sanitized;
    },
  });
  let renderResult;
  try {
    const marginObj:
      | string
      | {
          readonly top?: string;
          readonly right?: string;
          readonly bottom?: string;
          readonly left?: string;
        }
      | undefined =
      typeof options.margin === "string"
        ? options.margin
        : options.margin
          ? {
              ...(options.margin.top !== undefined
                ? { top: options.margin.top }
                : {}),
              ...(options.margin.right !== undefined
                ? { right: options.margin.right }
                : {}),
              ...(options.margin.bottom !== undefined
                ? { bottom: options.margin.bottom }
                : {}),
              ...(options.margin.left !== undefined
                ? { left: options.margin.left }
                : {}),
            }
          : undefined;

    renderResult = await renderer.render(publication, {
      pageSize: options.pageSize ?? "A4",
      ...(marginObj !== undefined ? { margin: marginObj } : {}),
      writingMode: options.writingMode ?? "auto",
    });
  } catch (error) {
    throw new ExportError(
      "PDF_RENDER_FAILED",
      `Failed to render PDF: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  // Validate PDF bytes
  const validator = new BaselinePdfValidator();
  const validation = await validator.validate(renderResult);

  if (!validation.valid) {
    throw new ExportError(
      "PDF_VALIDATION_FAILED",
      `Rendered PDF failed baseline validation: ${validation.issues.join(", ")}`,
    );
  }

  if (validation.issues.length > 0) {
    warnings.push(...validation.issues);
  }

  return {
    bytes: renderResult.bytes,
    pageCount: validation.pageCount,
    warnings,
  };
}
