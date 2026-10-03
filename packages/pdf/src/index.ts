/** Shared PDF output value used by renderer and validation boundaries. */
export type { PdfDocument } from "@reflowpress/core";

export interface PdfInspectionResult {
  readonly valid: boolean;
  readonly byteLength: number;
  readonly hasSignature: boolean;
  readonly version?: string | undefined;
  readonly pageCount: number;
  readonly issues: readonly string[];
}

/**
 * Basic structural sanity inspection for PDF byte buffers.
 * Validates the %PDF- magic signature, extracts version, and estimates page count.
 */
export function inspectPdfBytes(bytes: Uint8Array): PdfInspectionResult {
  const issues: string[] = [];

  if (!bytes || bytes.length === 0) {
    return {
      valid: false,
      byteLength: 0,
      hasSignature: false,
      version: undefined,
      pageCount: 0,
      issues: ["PDF buffer is empty or null."],
    };
  }

  // Header check: must start with %PDF- within the first 1024 bytes (standard allows small header offset)
  const headerSlice = bytes.subarray(0, Math.min(bytes.length, 1024));
  const headerStr = new TextDecoder("latin1").decode(headerSlice);
  const pdfMatch = headerStr.match(/%PDF-(\d+\.\d+)/);

  const hasSignature = pdfMatch !== null;
  const version = pdfMatch ? pdfMatch[1] : undefined;

  if (!hasSignature) {
    issues.push("Missing required '%PDF-' magic header signature.");
  }

  // Count /Type /Page objects (distinct from /Type /Pages)
  const contentStr = new TextDecoder("latin1").decode(bytes);
  let pageCount = 0;

  // Pattern: /Type\s*\/Page\b (not preceded by or followed by 's')
  const pageRegex = /\/Type\s*\/Page\b(?!\s*s)/g;
  while (pageRegex.exec(contentStr) !== null) {
    pageCount += 1;
  }

  // Fallback: check Root Pages /Count <n> if object enumeration yields 0
  if (pageCount === 0) {
    const countMatch = contentStr.match(
      /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/,
    );
    if (countMatch && countMatch[1]) {
      pageCount = parseInt(countMatch[1], 10);
    }
  }

  if (pageCount === 0) {
    issues.push("Could not find any valid pages in PDF structure.");
  }

  return {
    valid: issues.length === 0,
    byteLength: bytes.length,
    hasSignature,
    version,
    pageCount,
    issues,
  };
}
