import type { PdfDocument } from "@reflowpress/core";
import { inspectPdfBytes } from "@reflowpress/pdf";

export interface PdfValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly pageCount?: number;
}

/** PDF output validation policy interface. */
export interface PdfValidator {
  validate(document: PdfDocument): Promise<PdfValidationResult>;
}

/**
 * Baseline PDF validator for Milestone 0.7.
 * Verifies non-empty buffer, '%PDF-' signature, and page count > 0.
 * Comprehensive PDF Quality Gate rules (font embedding, visual regression, PDF/A) are deferred to Milestone 0.8.
 */
export class BaselinePdfValidator implements PdfValidator {
  async validate(document: PdfDocument): Promise<PdfValidationResult> {
    const inspection = inspectPdfBytes(document.bytes);
    return {
      valid: inspection.valid,
      issues: inspection.issues,
      pageCount: inspection.pageCount,
    };
  }
}
