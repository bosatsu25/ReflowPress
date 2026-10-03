export type ExportFormat = "pdf" | "html" | "markdown" | "all";

export type ExportPageSize = "A4" | "A5" | "B5" | "Letter";

export type ExportWritingMode = "auto" | "horizontal-tb" | "vertical-rl";

export interface ExportMargins {
  readonly top?: string | undefined;
  readonly right?: string | undefined;
  readonly bottom?: string | undefined;
  readonly left?: string | undefined;
}

export interface ExportOptions {
  readonly format: ExportFormat;
  readonly outputDir?: string | undefined;
  readonly pageSize?: ExportPageSize | undefined;
  readonly margin?: string | ExportMargins | undefined;
  readonly writingMode?: ExportWritingMode | undefined;
  readonly overwrite?: boolean | undefined;
  readonly clock?: (() => Date) | undefined;
}

export interface ExportResult {
  readonly inputPath: string;
  readonly format: "pdf" | "html" | "markdown";
  readonly outputPath: string;
  readonly assetDirectoryPath?: string | undefined;
  readonly byteSize: number;
  readonly durationMs: number;
  readonly warnings: readonly string[];
}

export type ExportErrorCode =
  | "INPUT_NOT_FOUND"
  | "UNSUPPORTED_INPUT"
  | "INVALID_EPUB"
  | "DRM_PROTECTED_PUBLICATION"
  | "EXPORT_PREPARE_FAILED"
  | "HTML_EXPORT_FAILED"
  | "MARKDOWN_EXPORT_FAILED"
  | "PDF_RENDER_FAILED"
  | "PDF_VALIDATION_FAILED"
  | "OUTPUT_WRITE_FAILED"
  | "OUTPUT_COLLISION_FAILED";

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string, options?: ErrorOptions) {
    super(`[${code}] ${message}`, options);
    this.name = "ExportError";
    this.code = code;
  }
}
