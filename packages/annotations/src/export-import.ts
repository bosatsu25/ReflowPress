import type {
  Annotation,
  AnnotationStore,
  BookmarkAnnotation,
  HighlightAnnotation,
  NoteAnnotation,
  PublicationIdentity,
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
  errors: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  lines.push(`# ${publication.title}`);
  if (publication.creator) {
    lines.push(`*By ${publication.creator}*`);
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
      lines.push(`> ${h.textQuote.exact}\n`);
      const locStr =
        h.locator.kind === "pdf"
          ? `Page ${h.locator.page}`
          : `Section ${h.locator.sectionHref}`;
      lines.push(`- **Color**: ${h.color} | **Location**: ${locStr}`);

      // Check if linked note exists
      const linkedNote = notes.find(
        (n) => n.id === h.noteId || n.highlightId === h.id,
      );
      if (linkedNote) {
        lines.push(`- **Note**: ${linkedNote.body}`);
      }
      lines.push(``);
    }
  }

  // Standalone notes (not linked to highlights)
  const standaloneNotes = notes.filter((n) => !n.highlightId);
  if (standaloneNotes.length > 0) {
    lines.push(`## Notes\n`);
    for (const n of standaloneNotes) {
      const locStr =
        n.locator.kind === "pdf"
          ? `Page ${n.locator.page}`
          : `Section ${n.locator.sectionHref}`;
      lines.push(`- **Location**: ${locStr}`);
      lines.push(`  ${n.body}\n`);
    }
  }

  if (bookmarks.length > 0) {
    lines.push(`## Bookmarks\n`);
    for (const b of bookmarks) {
      const locStr =
        b.locator.kind === "pdf"
          ? `Page ${b.locator.page}`
          : `Section ${b.locator.sectionHref}`;
      const labelStr = b.label ? ` — *${b.label}*` : "";
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

  const titleEsc = escapeHtml(publication.title);
  const authorEsc = publication.creator ? escapeHtml(publication.creator) : "";

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
      const exactEsc = escapeHtml(h.textQuote.exact);
      const locStr =
        h.locator.kind === "pdf"
          ? `Page ${h.locator.page}`
          : `Section ${escapeHtml(h.locator.sectionHref)}`;
      const linkedNote = notes.find(
        (n) => n.id === h.noteId || n.highlightId === h.id,
      );

      bodyHtml += `<div class="highlight-item ${h.color}">`;
      bodyHtml += `<blockquote>${exactEsc}</blockquote>`;
      bodyHtml += `<div class="meta"><span>Color: ${h.color}</span> | <span>Location: ${locStr}</span></div>`;
      if (linkedNote) {
        bodyHtml += `<div class="note-box"><strong>Note:</strong> ${escapeHtml(linkedNote.body)}</div>`;
      }
      bodyHtml += `</div>`;
    }
  }

  const standaloneNotes = notes.filter((n) => !n.highlightId);
  if (standaloneNotes.length > 0) {
    bodyHtml += `<h2>Notes</h2>`;
    for (const n of standaloneNotes) {
      const locStr =
        n.locator.kind === "pdf"
          ? `Page ${n.locator.page}`
          : `Section ${escapeHtml(n.locator.sectionHref)}`;
      bodyHtml += `<div class="note-item">`;
      bodyHtml += `<div class="meta">Location: ${locStr}</div>`;
      bodyHtml += `<p>${escapeHtml(n.body)}</p>`;
      bodyHtml += `</div>`;
    }
  }

  if (bookmarks.length > 0) {
    bodyHtml += `<h2>Bookmarks</h2><ul>`;
    for (const b of bookmarks) {
      const locStr =
        b.locator.kind === "pdf"
          ? `Page ${b.locator.page}`
          : `Section ${escapeHtml(b.locator.sectionHref)}`;
      const labelStr = b.label ? ` — <em>${escapeHtml(b.label)}</em>` : "";
      bodyHtml += `<li>${locStr}${labelStr}</li>`;
    }
    bodyHtml += `</ul>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
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

export function importAnnotationsFromJson(
  rawJsonString: string,
  targetPublicationId: string,
  existingStore: AnnotationStore,
): { store: AnnotationStore; report: ImportReport } {
  const report: ImportReport = {
    totalInFile: 0,
    imported: 0,
    skippedDuplicates: 0,
    conflictsResolved: 0,
    errors: [],
  };

  // Limit raw payload size to 5MB
  if (rawJsonString.length > 5 * 1024 * 1024) {
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

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>)["format"] !== "reflowpress-annotations"
  ) {
    report.errors.push("Invalid format: expected 'reflowpress-annotations'");
    return { store: existingStore, report };
  }

  const file = parsed as Partial<PortableAnnotationFile>;
  if (file.version !== 1) {
    report.errors.push(`Unsupported format version: ${String(file.version)}`);
    return { store: existingStore, report };
  }

  if (!Array.isArray(file.annotations)) {
    report.errors.push("Malformed annotations array");
    return { store: existingStore, report };
  }

  if (file.annotations.length > 10000) {
    report.errors.push("Exceeds maximum allowable annotations count (10,000)");
    return { store: existingStore, report };
  }

  report.totalInFile = file.annotations.length;
  const currentAnnotations = [...existingStore.annotations];

  for (const item of file.annotations) {
    if (!item || typeof item !== "object") continue;

    const ann = item as Partial<Annotation>;
    if (!ann.id || !ann.kind || !ann.locator) continue;

    // Check note body length
    if (
      ann.kind === "note" &&
      typeof (ann as NoteAnnotation).body === "string"
    ) {
      if ((ann as NoteAnnotation).body.length > 65536) {
        report.errors.push(
          `Note ${ann.id} exceeds 64KB length limit, skipping`,
        );
        continue;
      }
    }

    // Check ID collisions
    const existingIndex = currentAnnotations.findIndex((a) => a.id === ann.id);
    if (existingIndex !== -1) {
      const existing = currentAnnotations[existingIndex]!;
      // If identical content, skip
      if (JSON.stringify(existing) === JSON.stringify(ann)) {
        report.skippedDuplicates++;
        continue;
      }

      // Conflict: same ID but different content. Generate fresh ID
      const resolvedId = generateAnnotationId();
      const resolvedAnn = {
        ...(ann as Annotation),
        id: resolvedId,
        publicationId: targetPublicationId,
      };
      currentAnnotations.push(resolvedAnn);
      report.conflictsResolved++;
      report.imported++;
    } else {
      // Safe addition
      const importedAnn = {
        ...(ann as Annotation),
        publicationId: targetPublicationId,
      };
      currentAnnotations.push(importedAnn);
      report.imported++;
    }
  }

  return {
    store: {
      ...existingStore,
      annotations: currentAnnotations,
    },
    report,
  };
}
