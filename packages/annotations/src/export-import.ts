import type {
  Annotation,
  AnnotationColor,
  AnnotationStore,
  BookmarkAnnotation,
  EpubPublicationLocator,
  HighlightAnnotation,
  NormalizedRect,
  NoteAnnotation,
  PdfPublicationLocator,
  PublicationIdentity,
  PublicationLocator,
  TextPositionSelector,
  TextQuoteSelector,
} from "./models.js";
import { generateAnnotationId } from "./operations.js";

export interface PortableAnnotationFile {
  format: "reflowpress-annotations";
  version: 1;
  publication: PublicationIdentity;
  exportedAt: string;
  annotations: Annotation[];
}

export interface ImportReport {
  totalInFile: number;
  imported: number;
  skippedDuplicates: number;
  conflictsResolved: number;
  /** Records rejected because they failed schema validation (details in `errors`). */
  rejected: number;
  errors: string[];
}

/** Maximum payload size accepted by importAnnotationsFromJson (5 MB). */
export const MAX_ANNOTATION_IMPORT_BYTES = 5 * 1024 * 1024;
/** Maximum number of records in one import file. */
export const MAX_ANNOTATION_IMPORT_RECORDS = 10000;
/** Maximum note body length (64 KB). */
export const MAX_NOTE_BODY_LENGTH = 65536;

const MAX_TEXT_LENGTH = 65536;
const MAX_ID_LENGTH = 256;
const MAX_HREF_LENGTH = 4096;
const MAX_RECTS = 1000;
const MAX_REPORTED_ERRORS = 100;

export const ANNOTATION_COLORS: readonly AnnotationColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
];

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function createEmptyImportReport(): ImportReport {
  return {
    totalInFile: 0,
    imported: 0,
    skippedDuplicates: 0,
    conflictsResolved: 0,
    rejected: 0,
    errors: [],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MARKDOWN_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\\": "\\\\",
  "[": "\\[",
  "]": "\\]",
  "`": "\\`",
};

/** Escapes user content so it cannot become raw HTML, links or code in Markdown. */
function escapeMarkdown(text: string): string {
  return text.replace(/[&<>\\[\]`]/g, (ch) => MARKDOWN_ESCAPES[ch] ?? ch);
}

/**
 * Collapses line breaks, with the whitespace around them, into single spaces.
 * Split-based, because a single regex matching whitespace around the breaks
 * is quadratic on long blank runs.
 */
function singleLine(text: string): string {
  const parts = text.split(/[\r\n]+/);
  if (parts.length === 1) return text;
  const last = parts.length - 1;
  const kept: string[] = [];
  parts.forEach((part, index) => {
    const trimmed =
      index === 0
        ? part.trimEnd()
        : index === last
          ? part.trimStart()
          : part.trim();
    if (trimmed || index === 0 || index === last) kept.push(trimmed);
  });
  return kept.join(" ");
}

function isAnnotationColor(value: unknown): value is AnnotationColor {
  return (
    typeof value === "string" &&
    (ANNOTATION_COLORS as readonly string[]).includes(value)
  );
}

/** Plain-text (unescaped) description of a locator; robust to malformed data. */
function describeLocation(locator: PublicationLocator | undefined): string {
  if (!locator || typeof locator !== "object") return "Unknown location";
  if (locator.kind === "pdf") return `Page ${String(locator.page)}`;
  return `Section ${String(locator.sectionHref)}`;
}

export function exportAnnotationsToJson(
  store: AnnotationStore,
  publication: PublicationIdentity,
  publicationId?: string | undefined,
): string {
  const filtered = publicationId
    ? store.annotations.filter((a) => a.publicationId === publicationId)
    : store.annotations;

  const portable: PortableAnnotationFile = {
    format: "reflowpress-annotations",
    version: 1,
    publication,
    exportedAt: new Date().toISOString(),
    annotations: filtered,
  };

  return JSON.stringify(portable, null, 2);
}

export function exportAnnotationsToMarkdown(
  store: AnnotationStore,
  publication: PublicationIdentity,
  publicationId?: string | undefined,
): string {
  const filtered = publicationId
    ? store.annotations.filter((a) => a.publicationId === publicationId)
    : store.annotations;

  const lines: string[] = [];
  lines.push(`# ${escapeMarkdown(singleLine(String(publication.title)))}`);
  if (publication.creator) {
    lines.push(
      `*By ${escapeMarkdown(singleLine(String(publication.creator)))}*`,
    );
  }
  lines.push(
    `\n*Exported from ReflowPress on ${new Date().toLocaleDateString()}*\n`,
  );

  const bookmarks = filtered.filter(
    (a): a is BookmarkAnnotation => a.kind === "bookmark",
  );
  const highlights = filtered.filter(
    (a): a is HighlightAnnotation => a.kind === "highlight",
  );
  const notes = filtered.filter((a): a is NoteAnnotation => a.kind === "note");

  if (highlights.length > 0) {
    lines.push(`## Highlights\n`);
    for (const h of highlights) {
      const quoted = escapeMarkdown(String(h.textQuote?.exact ?? ""))
        .split(/\r\n|\r|\n/)
        .map((line) => `> ${line}`)
        .join("\n");
      lines.push(`${quoted}\n`);
      const locStr = escapeMarkdown(singleLine(describeLocation(h.locator)));
      lines.push(
        `- **Color**: ${escapeMarkdown(singleLine(String(h.color)))} | **Location**: ${locStr}`,
      );

      // Check if linked note exists
      const linkedNote = notes.find(
        (n) => n.id === h.noteId || n.highlightId === h.id,
      );
      if (linkedNote) {
        lines.push(
          `- **Note**: ${escapeMarkdown(String(linkedNote.body)).replace(/\r\n|\r|\n/g, "\n  ")}`,
        );
      }
      lines.push(``);
    }
  }

  // Standalone notes (not linked to highlights)
  const standaloneNotes = notes.filter((n) => !n.highlightId);
  if (standaloneNotes.length > 0) {
    lines.push(`## Notes\n`);
    for (const n of standaloneNotes) {
      const locStr = escapeMarkdown(singleLine(describeLocation(n.locator)));
      lines.push(`- **Location**: ${locStr}`);
      lines.push(
        `  ${escapeMarkdown(String(n.body)).replace(/\r\n|\r|\n/g, "\n  ")}\n`,
      );
    }
  }

  if (bookmarks.length > 0) {
    lines.push(`## Bookmarks\n`);
    for (const b of bookmarks) {
      const locStr = escapeMarkdown(singleLine(describeLocation(b.locator)));
      const labelStr = b.label
        ? ` — *${escapeMarkdown(singleLine(String(b.label)))}*`
        : "";
      lines.push(`- ${locStr}${labelStr}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

export function exportAnnotationsToHtml(
  store: AnnotationStore,
  publication: PublicationIdentity,
  publicationId?: string | undefined,
): string {
  const filtered = publicationId
    ? store.annotations.filter((a) => a.publicationId === publicationId)
    : store.annotations;

  const titleEsc = escapeHtml(String(publication.title));
  const authorEsc = publication.creator
    ? escapeHtml(String(publication.creator))
    : "";

  const bookmarks = filtered.filter(
    (a): a is BookmarkAnnotation => a.kind === "bookmark",
  );
  const highlights = filtered.filter(
    (a): a is HighlightAnnotation => a.kind === "highlight",
  );
  const notes = filtered.filter((a): a is NoteAnnotation => a.kind === "note");

  let bodyHtml = `<h1>${titleEsc}</h1>`;
  if (authorEsc) {
    bodyHtml += `<p class="author">By ${authorEsc}</p>`;
  }
  bodyHtml += `<p class="date">Exported from ReflowPress on ${escapeHtml(new Date().toLocaleDateString())}</p><hr/>`;

  if (highlights.length > 0) {
    bodyHtml += `<h2>Highlights</h2>`;
    for (const h of highlights) {
      const exactEsc = escapeHtml(String(h.textQuote?.exact ?? ""));
      const locStr = escapeHtml(describeLocation(h.locator));
      const colorClass = isAnnotationColor(h.color) ? ` ${h.color}` : "";
      const linkedNote = notes.find(
        (n) => n.id === h.noteId || n.highlightId === h.id,
      );

      bodyHtml += `<div class="highlight-item${escapeHtml(colorClass)}">`;
      bodyHtml += `<blockquote>${exactEsc}</blockquote>`;
      bodyHtml += `<div class="meta"><span>Color: ${escapeHtml(String(h.color))}</span> | <span>Location: ${locStr}</span></div>`;
      if (linkedNote) {
        bodyHtml += `<div class="note-box"><strong>Note:</strong> ${escapeHtml(String(linkedNote.body))}</div>`;
      }
      bodyHtml += `</div>`;
    }
  }

  const standaloneNotes = notes.filter((n) => !n.highlightId);
  if (standaloneNotes.length > 0) {
    bodyHtml += `<h2>Notes</h2>`;
    for (const n of standaloneNotes) {
      const locStr = escapeHtml(describeLocation(n.locator));
      bodyHtml += `<div class="note-item">`;
      bodyHtml += `<div class="meta">Location: ${locStr}</div>`;
      bodyHtml += `<p>${escapeHtml(String(n.body))}</p>`;
      bodyHtml += `</div>`;
    }
  }

  if (bookmarks.length > 0) {
    bodyHtml += `<h2>Bookmarks</h2><ul>`;
    for (const b of bookmarks) {
      const locStr = escapeHtml(describeLocation(b.locator));
      const labelStr = b.label
        ? ` — <em>${escapeHtml(String(b.label))}</em>`
        : "";
      bodyHtml += `<li>${locStr}${labelStr}</li>`;
    }
    bodyHtml += `</ul>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${titleEsc} - ReflowPress Annotations</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 1.8rem; margin-bottom: 4px; }
    .author { color: #64748b; font-style: italic; margin-top: 0; }
    .date { color: #94a3b8; font-size: 0.85rem; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    h2 { font-size: 1.3rem; margin-top: 32px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    blockquote { margin: 12px 0 6px 0; padding: 10px 16px; border-left: 4px solid #cbd5e1; background: #f8fafc; font-size: 1.05rem; }
    .highlight-item.yellow blockquote { border-left-color: #eab308; background: #fefce8; }
    .highlight-item.green blockquote { border-left-color: #22c55e; background: #f0fdf4; }
    .highlight-item.blue blockquote { border-left-color: #3b82f6; background: #eff6ff; }
    .highlight-item.pink blockquote { border-left-color: #ec4899; background: #fdf2f8; }
    .meta { font-size: 0.82rem; color: #64748b; margin-bottom: 8px; }
    .note-box { background: #f1f5f9; padding: 8px 12px; border-radius: 4px; margin-top: 6px; font-size: 0.95rem; }
    .highlight-item, .note-item { margin-bottom: 20px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Import validation
// ---------------------------------------------------------------------------

class RecordValidationError extends Error {}

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: RawRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Reads an optional field; JSON `null` is treated as absent. */
function readOptional(record: RawRecord, key: string): unknown {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  return value === null ? undefined : value;
}

function fail(message: string): never {
  throw new RecordValidationError(message);
}

function validateString(
  value: unknown,
  field: string,
  maxLength: number,
  options: { allowEmpty?: boolean; message?: string } = {},
): string {
  if (typeof value !== "string") fail(`'${field}' must be a string`);
  if (!options.allowEmpty && value.length === 0) {
    fail(`'${field}' must not be empty`);
  }
  if (value.length > maxLength) {
    fail(options.message ?? `'${field}' exceeds ${maxLength} characters`);
  }
  return value;
}

function validateIdentifier(value: unknown, field: string): string {
  const id = validateString(value, field, MAX_ID_LENGTH);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(id)) {
    fail(`'${field}' contains control characters`);
  }
  return id;
}

function validateIsoDate(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !ISO_DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail(`'${field}' must be an ISO 8601 date-time string`);
  }
  return value;
}

function validateFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`'${field}' must be a finite number`);
  }
  return value;
}

function validateTextQuote(value: unknown, field: string): TextQuoteSelector {
  if (!isRecord(value)) fail(`'${field}' must be an object`);
  const quote: TextQuoteSelector = {
    exact: validateString(value["exact"], `${field}.exact`, MAX_TEXT_LENGTH),
  };
  const prefix = readOptional(value, "prefix");
  if (prefix !== undefined) {
    quote.prefix = validateString(prefix, `${field}.prefix`, MAX_TEXT_LENGTH, {
      allowEmpty: true,
    });
  }
  const suffix = readOptional(value, "suffix");
  if (suffix !== undefined) {
    quote.suffix = validateString(suffix, `${field}.suffix`, MAX_TEXT_LENGTH, {
      allowEmpty: true,
    });
  }
  return quote;
}

function validateTextPosition(
  value: unknown,
  field: string,
): TextPositionSelector {
  if (!isRecord(value)) fail(`'${field}' must be an object`);
  const start = value["start"];
  const end = value["end"];
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start as number) < 0 ||
    (end as number) < (start as number)
  ) {
    fail(`'${field}' must contain integer offsets with 0 <= start <= end`);
  }
  return { start: start as number, end: end as number };
}

function validateRects(value: unknown, field: string): NormalizedRect[] {
  if (!Array.isArray(value)) fail(`'${field}' must be an array`);
  if (value.length > MAX_RECTS) fail(`'${field}' has too many entries`);
  return value.map((rect, index) => {
    if (!isRecord(rect)) fail(`'${field}[${index}]' must be an object`);
    return {
      left: validateFiniteNumber(rect["left"], `${field}[${index}].left`),
      top: validateFiniteNumber(rect["top"], `${field}[${index}].top`),
      width: validateFiniteNumber(rect["width"], `${field}[${index}].width`),
      height: validateFiniteNumber(rect["height"], `${field}[${index}].height`),
    };
  });
}

function validateLocator(value: unknown): PublicationLocator {
  if (!isRecord(value)) fail("'locator' must be an object");

  const textQuoteRaw = readOptional(value, "textQuote");
  const textPositionRaw = readOptional(value, "textPosition");
  const textQuote =
    textQuoteRaw === undefined
      ? undefined
      : validateTextQuote(textQuoteRaw, "locator.textQuote");
  const textPosition =
    textPositionRaw === undefined
      ? undefined
      : validateTextPosition(textPositionRaw, "locator.textPosition");

  if (value["kind"] === "epub") {
    const locator: EpubPublicationLocator = {
      kind: "epub",
      sectionHref: validateString(
        value["sectionHref"],
        "locator.sectionHref",
        MAX_HREF_LENGTH,
      ),
    };
    const progress = readOptional(value, "progress");
    if (progress !== undefined) {
      const p = validateFiniteNumber(progress, "locator.progress");
      if (p < 0 || p > 1) fail("'locator.progress' must be between 0 and 1");
      locator.progress = p;
    }
    if (textQuote) locator.textQuote = textQuote;
    if (textPosition) locator.textPosition = textPosition;
    const structuralHint = readOptional(value, "structuralHint");
    if (structuralHint !== undefined) {
      locator.structuralHint = validateString(
        structuralHint,
        "locator.structuralHint",
        MAX_HREF_LENGTH,
        { allowEmpty: true },
      );
    }
    return locator;
  }

  if (value["kind"] === "pdf") {
    const page = value["page"];
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      fail("'locator.page' must be a positive integer");
    }
    const locator: PdfPublicationLocator = {
      kind: "pdf",
      page: page as number,
    };
    const zoom = readOptional(value, "zoom");
    if (zoom !== undefined) {
      const z = validateFiniteNumber(zoom, "locator.zoom");
      if (z <= 0) fail("'locator.zoom' must be positive");
      locator.zoom = z;
    }
    if (textQuote) locator.textQuote = textQuote;
    if (textPosition) locator.textPosition = textPosition;
    const rects = readOptional(value, "normalizedRects");
    if (rects !== undefined) {
      locator.normalizedRects = validateRects(rects, "locator.normalizedRects");
    }
    return locator;
  }

  fail("'locator.kind' must be 'epub' or 'pdf'");
}

/**
 * Validates one imported record against the annotation model and rebuilds it
 * field by field (unknown properties are never copied into the store).
 */
function validateImportedAnnotation(
  raw: unknown,
  targetPublicationId: string,
): Annotation {
  if (!isRecord(raw)) fail("record must be an object");

  const id = validateIdentifier(raw["id"], "id");
  const kind = raw["kind"];
  if (kind !== "bookmark" && kind !== "highlight" && kind !== "note") {
    fail("'kind' must be 'bookmark', 'highlight' or 'note'");
  }
  const createdAt = validateIsoDate(raw["createdAt"], "createdAt");
  const updatedAt = validateIsoDate(raw["updatedAt"], "updatedAt");
  const locator = validateLocator(raw["locator"]);

  if (kind === "bookmark") {
    const bookmark: BookmarkAnnotation = {
      id,
      publicationId: targetPublicationId,
      kind,
      locator,
      createdAt,
      updatedAt,
    };
    const label = readOptional(raw, "label");
    if (label !== undefined) {
      bookmark.label = validateString(label, "label", MAX_TEXT_LENGTH, {
        allowEmpty: true,
      });
    }
    return bookmark;
  }

  if (kind === "highlight") {
    const color = raw["color"];
    if (!isAnnotationColor(color)) {
      fail(`'color' must be one of ${ANNOTATION_COLORS.join(", ")}`);
    }
    const status = raw["status"];
    if (status !== "active" && status !== "orphaned") {
      fail("'status' must be 'active' or 'orphaned'");
    }
    const highlight: HighlightAnnotation = {
      id,
      publicationId: targetPublicationId,
      kind,
      locator,
      color,
      textQuote: validateTextQuote(raw["textQuote"], "textQuote"),
      status,
      createdAt,
      updatedAt,
    };
    const noteId = readOptional(raw, "noteId");
    if (noteId !== undefined) {
      highlight.noteId = validateIdentifier(noteId, "noteId");
    }
    return highlight;
  }

  const note: NoteAnnotation = {
    id,
    publicationId: targetPublicationId,
    kind,
    locator,
    body: validateString(raw["body"], "body", MAX_NOTE_BODY_LENGTH, {
      allowEmpty: true,
      message: "Note body exceeds 64KB length limit, skipping",
    }),
    createdAt,
    updatedAt,
  };
  const highlightId = readOptional(raw, "highlightId");
  if (highlightId !== undefined) {
    note.highlightId = validateIdentifier(highlightId, "highlightId");
  }
  return note;
}

/** Deterministic JSON (sorted keys, undefined dropped) for content comparison. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function importAnnotationsFromJson(
  rawJsonString: string,
  targetPublicationId: string,
  existingStore: AnnotationStore,
): { store: AnnotationStore; report: ImportReport } {
  const report = createEmptyImportReport();

  // Limit raw payload size to 5MB
  if (rawJsonString.length > MAX_ANNOTATION_IMPORT_BYTES) {
    report.errors.push("Import payload exceeds maximum size limit (5MB)");
    return { store: existingStore, report };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (err) {
    report.errors.push(`Invalid JSON syntax: ${String(err)}`);
    return { store: existingStore, report };
  }

  if (!isRecord(parsed) || parsed["format"] !== "reflowpress-annotations") {
    report.errors.push("Invalid format: expected 'reflowpress-annotations'");
    return { store: existingStore, report };
  }

  if (parsed["version"] !== 1) {
    report.errors.push(
      `Unsupported format version: ${String(parsed["version"]).slice(0, 32)}`,
    );
    return { store: existingStore, report };
  }

  const records = parsed["annotations"];
  if (!Array.isArray(records)) {
    report.errors.push("Malformed annotations array");
    return { store: existingStore, report };
  }

  if (records.length > MAX_ANNOTATION_IMPORT_RECORDS) {
    report.errors.push("Exceeds maximum allowable annotations count (10,000)");
    return { store: existingStore, report };
  }

  report.totalInFile = records.length;
  const currentAnnotations = [...existingStore.annotations];

  records.forEach((item: unknown, index) => {
    let candidate: Annotation;
    try {
      candidate = validateImportedAnnotation(item, targetPublicationId);
    } catch (error) {
      if (!(error instanceof RecordValidationError)) throw error;
      report.rejected++;
      if (report.errors.length < MAX_REPORTED_ERRORS) {
        const kind =
          isRecord(item) && typeof item["kind"] === "string"
            ? ` (${item["kind"].slice(0, 16)})`
            : "";
        report.errors.push(`Record ${index}${kind}: ${error.message}`);
      }
      return;
    }

    // Check ID collisions
    const existing = currentAnnotations.find((a) => a.id === candidate.id);
    if (existing) {
      // If identical content, skip
      if (canonicalJson(existing) === canonicalJson(candidate)) {
        report.skippedDuplicates++;
        return;
      }

      // Conflict: same ID but different content. Generate fresh ID
      currentAnnotations.push({ ...candidate, id: generateAnnotationId() });
      report.conflictsResolved++;
      report.imported++;
    } else {
      currentAnnotations.push(candidate);
      report.imported++;
    }
  });

  if (report.rejected > 0 && report.errors.length >= MAX_REPORTED_ERRORS) {
    report.errors.push(
      `${report.rejected} invalid record(s) were rejected in total.`,
    );
  }

  return {
    store: {
      ...existingStore,
      annotations: currentAnnotations,
    },
    report,
  };
}
