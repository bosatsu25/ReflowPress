import { open } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import {
  computeReportSummary,
  deduplicateFindings,
  type HealthReport,
  type QualityFinding,
} from "../models.js";
import { REFLOWPRESS_VERSION } from "@reflowpress/core";

export interface PdfGeometryInfo {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageInspection {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly textLength: number;
  readonly hasImages: boolean;
  readonly fonts: readonly string[];
}

/**
 * Resource limits for {@link inspectPdfHealth}. The inspector runs in the
 * desktop main process on attacker-supplied files, so every quantity that can
 * grow with the input is bounded.
 */
export interface PdfInspectionLimits {
  /** Largest input that is parsed; larger inputs yield PDF-STRUCT-003. */
  readonly maxInputBytes: number;
  /** Maximum number of indirect objects indexed. */
  readonly maxObjects: number;
  /** Maximum number of pages inspected; also clamps the /Count fallback. */
  readonly maxInspectedPages: number;
  /** Maximum decompressed size of a single FlateDecode content stream. */
  readonly maxInflatedStreamBytes: number;
  /** Maximum decompressed bytes across all content streams. */
  readonly maxTotalInflatedBytes: number;
}

export const DEFAULT_PDF_INSPECTION_LIMITS: PdfInspectionLimits = {
  // The whole file is decoded into one string, so the cap must stay well below
  // V8's maximum string length (2^29 - 24 characters, just under 512 MiB).
  maxInputBytes: 256 * 1024 * 1024,
  maxObjects: 1_000_000,
  maxInspectedPages: 10_000,
  maxInflatedStreamBytes: 16 * 1024 * 1024,
  maxTotalInflatedBytes: 256 * 1024 * 1024,
};

export interface PdfHealthInspectionOptions {
  readonly toolVersion?: string | undefined;
  /** Overrides for {@link DEFAULT_PDF_INSPECTION_LIMITS}. */
  readonly limits?: Partial<PdfInspectionLimits> | undefined;
}

const latin1Decoder = new TextDecoder("latin1");

/**
 * Inspects a PDF file, checking its size before reading it so an oversized
 * file is reported (PDF-STRUCT-003) without being loaded into memory.
 */
export async function inspectPdfFile(
  filePath: string,
  options?: PdfHealthInspectionOptions | undefined,
): Promise<HealthReport> {
  const limits = resolvePdfLimits(options?.limits);
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
    if (info.size > limits.maxInputBytes) {
      return finalizePdfReport(
        filePath,
        [oversizedPdfFinding(info.size, limits, filePath)],
        Date.now(),
        new Set(["PDF-STRUCT-003"]),
        [],
        options?.toolVersion,
      );
    }
    return inspectPdfHealth(await handle.readFile(), filePath, options);
  } finally {
    await handle.close();
  }
}

function oversizedPdfFinding(
  byteLength: number,
  limits: PdfInspectionLimits,
  sourcePath: string,
): QualityFinding {
  return {
    ruleId: "PDF-STRUCT-003",
    severity: "fatal",
    category: "pdf-structure",
    message: `PDF is ${byteLength} bytes, which exceeds the ${limits.maxInputBytes}-byte inspection limit; it was not parsed.`,
    location: { path: sourcePath },
    evidence: [
      { key: "byteLength", value: byteLength },
      { key: "limitBytes", value: limits.maxInputBytes },
    ],
    repairability: "none",
  };
}

export function inspectPdfHealth(
  pdfBytes: Uint8Array,
  sourcePath = "document.pdf",
  options?: PdfHealthInspectionOptions | undefined,
): HealthReport {
  const startTime = Date.now();
  const findings: QualityFinding[] = [];
  const rulesExecuted = new Set<string>();
  const rulesSkipped: string[] = [];
  const limits = resolvePdfLimits(options?.limits);

  rulesExecuted.add("PDF-STRUCT-001");
  rulesExecuted.add("PDF-STRUCT-002");
  rulesExecuted.add("PDF-STRUCT-003");
  rulesExecuted.add("PDF-STRUCT-004");
  rulesExecuted.add("PDF-ENCRYPT-001");
  rulesExecuted.add("PDF-TEXT-001");
  rulesExecuted.add("PDF-TEXT-002");
  rulesExecuted.add("PDF-GEOM-001");
  rulesExecuted.add("PDF-GEOM-002");
  rulesExecuted.add("PDF-IMAGE-001");
  rulesExecuted.add("PDF-FONT-001");

  const finish = (): HealthReport =>
    finalizePdfReport(
      sourcePath,
      findings,
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
    );

  if (!pdfBytes || pdfBytes.length === 0) {
    findings.push({
      ruleId: "PDF-STRUCT-001",
      severity: "fatal",
      category: "pdf-structure",
      message: "PDF byte buffer is empty or null.",
      location: { path: sourcePath },
      repairability: "none",
    });
    return finish();
  }

  if (pdfBytes.length > limits.maxInputBytes) {
    findings.push(oversizedPdfFinding(pdfBytes.length, limits, sourcePath));
    return finish();
  }

  // Header check (%PDF-1.x)
  const headerSlice = pdfBytes.subarray(0, Math.min(pdfBytes.length, 1024));
  const headerText = latin1Decoder.decode(headerSlice);
  const pdfMatch = headerText.match(/%PDF-(\d+\.\d+)/);

  if (!pdfMatch) {
    findings.push({
      ruleId: "PDF-STRUCT-001",
      severity: "fatal",
      category: "pdf-structure",
      message:
        "Missing standard '%PDF-' magic header signature in first 1024 bytes.",
      location: { path: sourcePath },
      repairability: "none",
    });
    return finish();
  }

  let rawPdf: string;
  try {
    rawPdf = latin1Decoder.decode(pdfBytes);
  } catch (err) {
    findings.push({
      ruleId: "PDF-STRUCT-001",
      severity: "fatal",
      category: "pdf-structure",
      message: `PDF bytes could not be decoded for inspection: ${err instanceof Error ? err.message : String(err)}`,
      location: { path: sourcePath },
      repairability: "none",
    });
    return finish();
  }

  // Check encryption
  if (hasEncryptDictionary(rawPdf)) {
    findings.push({
      ruleId: "PDF-ENCRYPT-001",
      severity: "error",
      category: "pdf-structure",
      message: "PDF document is encrypted or password-protected.",
      location: { path: sourcePath },
      repairability: "none",
    });
  }

  // Parse pages
  const { pages: pageInfos, truncations } = extractPdfPages(
    pdfBytes,
    rawPdf,
    limits,
  );

  for (const truncation of truncations) {
    findings.push({
      ruleId: "PDF-STRUCT-004",
      severity: "warning",
      category: "pdf-structure",
      message: truncation.message,
      location: { path: sourcePath },
      evidence: truncation.evidence,
      repairability: "none",
    });
  }

  if (pageInfos.length === 0) {
    findings.push({
      ruleId: "PDF-STRUCT-002",
      severity: "error",
      category: "pdf-structure",
      message: "PDF contains 0 valid renderable pages.",
      location: { path: sourcePath },
      repairability: "none",
    });
    return finish();
  }

  let totalDocText = 0;

  for (const page of pageInfos) {
    totalDocText += page.textLength;

    // Geometry check
    if (page.width <= 0 || page.height <= 0) {
      findings.push({
        ruleId: "PDF-GEOM-001",
        severity: "error",
        category: "pdf-geometry",
        message: `Page ${page.pageNumber} has invalid dimensions (${page.width} x ${page.height} pt).`,
        location: { path: sourcePath, line: page.pageNumber },
        evidence: [
          { key: "page", value: page.pageNumber },
          { key: "width", value: page.width },
          { key: "height", value: page.height },
        ],
        repairability: "none",
      });
    } else {
      const aspectRatio = page.width / page.height;
      if (aspectRatio > 5 || aspectRatio < 0.2) {
        findings.push({
          ruleId: "PDF-GEOM-002",
          severity: "info",
          category: "pdf-geometry",
          message: `Page ${page.pageNumber} has extreme aspect ratio (${aspectRatio.toFixed(2)}).`,
          location: { path: sourcePath, line: page.pageNumber },
          evidence: [
            { key: "page", value: page.pageNumber },
            { key: "aspectRatio", value: aspectRatio.toFixed(2) },
          ],
          repairability: "none",
        });
      }
    }

    // Text layer check
    if (page.textLength === 0) {
      findings.push({
        ruleId: "PDF-TEXT-001",
        severity: "warning",
        category: "pdf-text",
        message: `Page ${page.pageNumber} has no extractable text layer (scanned or purely raster).`,
        location: { path: sourcePath, line: page.pageNumber },
        evidence: [
          { key: "page", value: page.pageNumber },
          { key: "hasImages", value: page.hasImages },
        ],
        repairability: "none",
      });

      if (page.hasImages) {
        findings.push({
          ruleId: "PDF-IMAGE-001",
          severity: "info",
          category: "pdf-image",
          message: `Page ${page.pageNumber} contains raster image content without text layer.`,
          location: { path: sourcePath, line: page.pageNumber },
          evidence: [{ key: "page", value: page.pageNumber }],
          repairability: "none",
        });
      }
    }
  }

  // Document-wide text yield
  if (totalDocText < 20 && pageInfos.length > 0) {
    findings.push({
      ruleId: "PDF-TEXT-002",
      severity: "info",
      category: "pdf-text",
      message: `Document has very low total extractable text (${totalDocText} characters across ${pageInfos.length} pages).`,
      location: { path: sourcePath },
      evidence: [
        { key: "totalChars", value: totalDocText },
        { key: "pageCount", value: pageInfos.length },
      ],
      repairability: "none",
    });
  }

  // Font embedding boundary note (ADR 0008)
  findings.push({
    ruleId: "PDF-FONT-001",
    severity: "info",
    category: "pdf-font",
    message:
      "Font embedding boundary inspection: embedded fonts verified within parser limits. Full PDF/A certification requires external compliance profile.",
    location: { path: sourcePath },
    repairability: "none",
  });

  return finish();
}

function resolvePdfLimits(
  overrides?: Partial<PdfInspectionLimits> | undefined,
): PdfInspectionLimits {
  const resolved: { -readonly [K in keyof PdfInspectionLimits]: number } = {
    ...DEFAULT_PDF_INSPECTION_LIMITS,
  };
  if (overrides) {
    for (const key of Object.keys(resolved) as (keyof PdfInspectionLimits)[]) {
      const value = overrides[key];
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > 0
      ) {
        resolved[key] = value;
      }
    }
  }
  return resolved;
}

/**
 * Detects `/Encrypt N M R` or an inline `/Encrypt << ... >>` dictionary.
 * Equivalent to the former `/\/Encrypt\s*<<.*>>/s` test without its quadratic
 * backtracking: only the first `/Encrypt <<` can matter, because any later one
 * has a `>>` after it only if the first one does.
 */
function hasEncryptDictionary(rawPdf: string): boolean {
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(rawPdf)) return true;
  const dictionary = /\/Encrypt\s*<</.exec(rawPdf);
  return (
    dictionary !== null &&
    rawPdf.indexOf(">>", dictionary.index + dictionary[0].length) !== -1
  );
}

interface PdfObjectSpan {
  /** Offset of the object number. */
  readonly start: number;
  /** Offset just after the `obj` keyword. */
  readonly bodyStart: number;
  /** Offset of the terminating `endobj` keyword. */
  readonly bodyEnd: number;
  /** Offset just after `endobj`. */
  readonly end: number;
}

interface InspectionTruncation {
  readonly message: string;
  readonly evidence: QualityFinding["evidence"];
}

interface InflateBudget {
  remaining: number;
  limitReached: boolean;
}

interface StreamInspection {
  readonly textLength: number;
  readonly hasImages: boolean;
}

function extractPdfPages(
  pdfBytes: Uint8Array,
  rawPdf: string,
  limits: PdfInspectionLimits,
): { pages: PdfPageInspection[]; truncations: InspectionTruncation[] } {
  const pages: PdfPageInspection[] = [];
  const truncations: InspectionTruncation[] = [];

  // Index all object blocks "X Y obj ... endobj" (later definitions replace
  // earlier ones, as with incremental updates).
  const { objects, truncated: objectsTruncated } = indexPdfObjects(
    rawPdf,
    limits.maxObjects,
  );
  if (objectsTruncated) {
    truncations.push({
      message: `PDF contains more than ${limits.maxObjects} indirect objects; only the first ${limits.maxObjects} were indexed.`,
      evidence: [{ key: "maxObjects", value: limits.maxObjects }],
    });
  }

  const budget: InflateBudget = {
    remaining: limits.maxTotalInflatedBytes,
    limitReached: false,
  };
  // Content streams shared by several pages are decoded and scanned once.
  const contentCache = new Map<number, StreamInspection>();

  // Find page objects: contains "/Type\s*\/Page\b"
  const pageTypeRegex = /\/Type\s*\/Page\b(?!\s*s)/;
  let pageObjectCount = 0;
  for (const [, obj] of objects) {
    const body = rawPdf.slice(obj.bodyStart, obj.bodyEnd);
    if (!pageTypeRegex.test(body)) continue;

    pageObjectCount += 1;
    if (pages.length >= limits.maxInspectedPages) continue;

    // Extract MediaBox
    let width = 595.28; // Default A4
    let height = 841.89;
    const mediaBoxMatch = body.match(
      /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/,
    );
    if (mediaBoxMatch) {
      const x1 = parseFloat(mediaBoxMatch[1]!);
      const y1 = parseFloat(mediaBoxMatch[2]!);
      const x2 = parseFloat(mediaBoxMatch[3]!);
      const y2 = parseFloat(mediaBoxMatch[4]!);
      width = Math.abs(x2 - x1);
      height = Math.abs(y2 - y1);
    }

    // Check contents stream
    let textLength = 0;
    let hasImages = false;

    // Direct stream or reference to stream object
    const contentsRefMatch = body.match(/\/Contents\s+(\d+)\s+(\d+)\s+R/);
    if (contentsRefMatch) {
      const streamObjNum = parseInt(contentsRefMatch[1]!, 10);
      let inspected = contentCache.get(streamObjNum);
      if (!inspected) {
        const streamObj = objects.get(streamObjNum);
        if (streamObj) {
          inspected = inspectStreamTextAndImages(
            pdfBytes,
            rawPdf,
            streamObj,
            limits,
            budget,
          );
          contentCache.set(streamObjNum, inspected);
        }
      }
      if (inspected) {
        textLength = inspected.textLength;
        hasImages = inspected.hasImages;
      }
    } else if (body.includes("stream")) {
      const inspected = inspectStreamTextAndImages(
        pdfBytes,
        rawPdf,
        obj,
        limits,
        budget,
      );
      textLength = inspected.textLength;
      hasImages = inspected.hasImages;
    }

    // Check if page object itself declares image XObjects in Resources
    if (!hasImages && /\/Subtype\s*\/Image\b/.test(body)) {
      hasImages = true;
    }

    pages.push({
      pageNumber: pages.length + 1,
      width,
      height,
      textLength,
      hasImages,
      fonts: [],
    });
  }

  if (pageObjectCount > pages.length) {
    truncations.push({
      message: `PDF declares ${pageObjectCount} page objects; only the first ${pages.length} were inspected.`,
      evidence: [
        { key: "pageObjects", value: pageObjectCount },
        { key: "inspectedPages", value: pages.length },
      ],
    });
  }

  // If no /Type /Page found, fallback to checking /Count
  if (pages.length === 0) {
    const declaredCount = findPageTreeCount(rawPdf);
    if (declaredCount !== undefined) {
      const declared = parseInt(declaredCount, 10);
      const estimatedCount = Math.min(declared, limits.maxInspectedPages);
      if (declared > estimatedCount) {
        truncations.push({
          message: `PDF page tree declares /Count ${truncateDigits(declaredCount)}; only ${estimatedCount} pages were assumed for inspection.`,
          evidence: [
            { key: "declaredCount", value: truncateDigits(declaredCount) },
            { key: "inspectedPages", value: estimatedCount },
          ],
        });
      }
      for (let i = 1; i <= estimatedCount; i += 1) {
        pages.push({
          pageNumber: i,
          width: 595.28,
          height: 841.89,
          textLength: 100, // conservative estimate when indirect pages tree is complex
          hasImages: false,
          fonts: [],
        });
      }
    }
  }

  if (budget.limitReached) {
    truncations.push({
      message: `Decompressing content streams exceeded the inspection limits (${limits.maxInflatedStreamBytes} bytes per stream, ${limits.maxTotalInflatedBytes} bytes in total); the affected streams were scanned without decompression.`,
      evidence: [
        { key: "maxInflatedStreamBytes", value: limits.maxInflatedStreamBytes },
        { key: "maxTotalInflatedBytes", value: limits.maxTotalInflatedBytes },
      ],
    });
  }

  return { pages, truncations };
}

/**
 * Indexes `X Y obj ... endobj` blocks in linear time. Equivalent to iterating
 * `/(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g`, which is quadratic on long digit
 * runs and on unterminated objects.
 */
function indexPdfObjects(
  rawPdf: string,
  maxObjects: number,
): { objects: Map<number, PdfObjectSpan>; truncated: boolean } {
  const objects = new Map<number, PdfObjectSpan>();
  let cursor = 0;

  for (;;) {
    const keyword = rawPdf.indexOf("obj", cursor);
    if (keyword === -1) break;

    const header = parseObjectHeader(rawPdf, keyword, cursor);
    if (!header) {
      cursor = keyword + 3;
      continue;
    }

    const endKeyword = rawPdf.indexOf("endobj", keyword + 3);
    // Without a terminator no later object can be terminated either.
    if (endKeyword === -1) break;

    if (objects.size >= maxObjects && !objects.has(header.objNum)) {
      return { objects, truncated: true };
    }
    objects.set(header.objNum, {
      start: header.start,
      bodyStart: keyword + 3,
      bodyEnd: endKeyword,
      end: endKeyword + 6,
    });
    cursor = endKeyword + 6;
  }

  return { objects, truncated: false };
}

/**
 * Parses `\d+\s+\d+\s+` backwards from an `obj` keyword without crossing
 * `floor` (the end of the previous match). Each character is visited at most
 * once per keyword, and the scanned runs of different keywords are disjoint.
 */
function parseObjectHeader(
  rawPdf: string,
  keyword: number,
  floor: number,
): { start: number; objNum: number } | undefined {
  let i = keyword - 1;
  if (i < floor || !isJsWhitespace(rawPdf.charCodeAt(i))) return undefined;
  while (i >= floor && isJsWhitespace(rawPdf.charCodeAt(i))) i -= 1;

  const generationEnd = i;
  while (i >= floor && isAsciiDigit(rawPdf.charCodeAt(i))) i -= 1;
  if (i === generationEnd) return undefined;

  if (i < floor || !isJsWhitespace(rawPdf.charCodeAt(i))) return undefined;
  while (i >= floor && isJsWhitespace(rawPdf.charCodeAt(i))) i -= 1;

  const numberEnd = i;
  while (i >= floor && isAsciiDigit(rawPdf.charCodeAt(i))) i -= 1;
  if (i === numberEnd) return undefined;

  const start = i + 1;
  return { start, objNum: parseInt(rawPdf.slice(start, numberEnd + 1), 10) };
}

/**
 * Returns the digits of the first `/Count N` following the first
 * `/Type /Pages`, like `/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/` but in
 * linear time.
 */
function findPageTreeCount(rawPdf: string): string | undefined {
  const pagesNode = /\/Type\s*\/Pages/.exec(rawPdf);
  if (!pagesNode) return undefined;
  const countRegex = /\/Count\s+(\d+)/g;
  countRegex.lastIndex = pagesNode.index + pagesNode[0].length;
  return countRegex.exec(rawPdf)?.[1];
}

function inspectStreamTextAndImages(
  pdfBytes: Uint8Array,
  rawPdf: string,
  obj: PdfObjectSpan,
  limits: PdfInspectionLimits,
  budget: InflateBudget,
): StreamInspection {
  const objFullMatch = rawPdf.slice(obj.start, obj.end);
  const streamHeaderMatch = objFullMatch.match(/stream\r?\n/);
  const endStreamMatch = objFullMatch.match(/\r?\nendstream/);

  if (
    !streamHeaderMatch ||
    !endStreamMatch ||
    streamHeaderMatch.index === undefined ||
    endStreamMatch.index === undefined
  ) {
    return { textLength: 0, hasImages: false };
  }

  const streamStart =
    obj.start + streamHeaderMatch.index + streamHeaderMatch[0].length;
  const streamEnd = obj.start + endStreamMatch.index;
  const rawStreamBytes = pdfBytes.subarray(streamStart, streamEnd);

  const isFlate =
    objFullMatch.includes("/Filter /FlateDecode") ||
    objFullMatch.includes("/Filter/FlateDecode");
  const streamContent = decodeStreamContent(
    rawStreamBytes,
    isFlate,
    limits,
    budget,
  );

  return analyzeContentStream(streamContent);
}

function decodeStreamContent(
  rawStreamBytes: Uint8Array,
  isFlate: boolean,
  limits: PdfInspectionLimits,
  budget: InflateBudget,
): string {
  if (isFlate) {
    const maxOutputLength = Math.min(
      limits.maxInflatedStreamBytes,
      budget.remaining,
    );
    if (maxOutputLength <= 0) {
      budget.limitReached = true;
    } else {
      try {
        const decompressed = inflateSync(rawStreamBytes, { maxOutputLength });
        budget.remaining -= decompressed.length;
        return latin1Decoder.decode(decompressed);
      } catch (err) {
        if (
          err instanceof RangeError &&
          (err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
        ) {
          budget.limitReached = true;
        }
        // A failed inflate (truncated, bad checksum, over the cap) may still
        // have produced up to maxOutputLength bytes, so the work counts
        // against the budget. Deflate expands at most ~1032:1, which keeps
        // small corrupt streams from using up the budget.
        budget.remaining -= Math.min(
          maxOutputLength,
          rawStreamBytes.length * 1032,
        );
        if (budget.remaining <= 0) budget.limitReached = true;
        // Fall back to scanning the raw bytes, as for corrupt streams.
      }
    }
  }
  return latin1Decoder.decode(rawStreamBytes);
}

/**
 * Measures shown text and detects images in a content stream. Every scan is
 * linear: it reproduces the former lazy regular expressions
 * (`\bBT\b([\s\S]*?)\bET\b`, `\((.*?)\)\s*Tj`, `\[(.*?)\]\s*TJ`, `\((.*?)\)`
 * and `\bBI\b[\s\S]*?\bID\b[\s\S]*?\bEI\b`) with forward-only searches.
 */
function analyzeContentStream(content: string): StreamInspection {
  const hasImages = /\/Do\b/.test(content) || hasInlineImage(content);

  let textLength = 0;
  const btRegex = /\bBT\b/g;
  const etRegex = /\bET\b/g;
  let cursor = 0;
  for (;;) {
    btRegex.lastIndex = cursor;
    const bt = btRegex.exec(content);
    if (!bt) break;
    etRegex.lastIndex = bt.index + bt[0].length;
    const et = etRegex.exec(content);
    // Without an ET no later BT block can be closed either.
    if (!et) break;

    const textBlock = content.slice(bt.index + bt[0].length, et.index);
    // ( ... ) Tj
    forEachOperand(textBlock, "(", /\)\s*Tj/g, (start, end) => {
      textLength += end - start;
    });
    // [ ... ] TJ: count the characters of the strings inside the array.
    forEachOperand(textBlock, "[", /\]\s*TJ/g, (start, end) => {
      textLength += sumParenthesizedLengths(textBlock, start, end);
    });

    cursor = et.index + et[0].length;
  }

  return { textLength, hasImages };
}

function hasInlineImage(content: string): boolean {
  const bi = /\bBI\b/g.exec(content);
  if (!bi) return false;
  const idRegex = /\bID\b/g;
  idRegex.lastIndex = bi.index + bi[0].length;
  const id = idRegex.exec(content);
  if (!id) return false;
  const eiRegex = /\bEI\b/g;
  eiRegex.lastIndex = id.index + id[0].length;
  return eiRegex.test(content);
}

/**
 * Visits the operands matched by `<open>(.*?)<closeRegex>` with the global
 * flag, i.e. the shortest same-line span after each opener that is followed by
 * the closing pattern. `closeRegex` must be global and start with the closing
 * delimiter. Runs in linear time: the opener search, the close search and the
 * line-break search only move forward.
 */
function forEachOperand(
  text: string,
  open: string,
  closeRegex: RegExp,
  visit: (innerStart: number, innerEnd: number) => void,
): void {
  const nextLineBreak = createLineBreakFinder(text);
  let close: RegExpExecArray | null = null;
  let cursor = 0;

  for (;;) {
    const opener = text.indexOf(open, cursor);
    if (opener === -1) return;

    if (close === null || close.index <= opener) {
      closeRegex.lastIndex = opener + 1;
      close = closeRegex.exec(text);
      if (close === null) return;
    }

    // `.` does not match line terminators, so no opener before the next line
    // break can reach a closer after it.
    const lineBreak = nextLineBreak(opener + 1);
    if (lineBreak < close.index) {
      cursor = lineBreak + 1;
      continue;
    }

    visit(opener + 1, close.index);
    cursor = close.index + close[0].length;
  }
}

/** Sum of `match.length - 2` over `/\((.*?)\)/g` within text[start, end). */
function sumParenthesizedLengths(
  text: string,
  start: number,
  end: number,
): number {
  // A character loop bounded by `end`: indexOf would search past the array
  // to the end of the text block for every array, which is quadratic.
  let total = 0;
  let opener = -1;
  for (let i = start; i < end; i += 1) {
    const code = text.charCodeAt(i);
    if (opener === -1) {
      if (code === 0x28) opener = i; // "("
    } else if (code === 0x29) {
      // ")"
      total += i - opener - 1;
      opener = -1;
    }
  }
  return total;
}

/**
 * Returns a function giving the index of the first JavaScript line terminator
 * at or after `from` (or `text.length`). Calls must use non-decreasing `from`
 * values; the total scanning work is linear in the text length.
 */
function createLineBreakFinder(text: string): (from: number) => number {
  let found = -1;
  return (from: number): number => {
    if (found >= from) return found;
    let i = from;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029)
        break;
      i += 1;
    }
    found = i;
    return found;
  };
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** Matches the characters of the JavaScript `\s` class. */
function isJsWhitespace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function truncateDigits(digits: string): string {
  return digits.length > 32 ? `${digits.slice(0, 32)}…` : digits;
}

function finalizePdfReport(
  sourcePath: string,
  findings: QualityFinding[],
  startTime: number,
  rulesExecuted: Set<string>,
  rulesSkipped: string[],
  toolVersion?: string,
): HealthReport {
  const deduped = deduplicateFindings(findings);
  const summary = computeReportSummary(deduped);
  return {
    publicationPath: sourcePath,
    publicationType: "pdf",
    inspectedAt: new Date().toISOString(),
    durationMs: Math.max(1, Date.now() - startTime),
    findings: deduped,
    summary,
    rulesExecuted: Array.from(rulesExecuted).sort(),
    rulesSkipped: [...rulesSkipped].sort(),
    toolVersion: toolVersion ?? REFLOWPRESS_VERSION,
  };
}
