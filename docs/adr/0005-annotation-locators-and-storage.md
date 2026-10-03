# ADR 0005: Annotation Locators, Selectors, and Storage Architecture

- **Status**: Accepted
- **Date**: 2026-10-03
- **Deciders**: ReflowPress Core & Architecture Team
- **Context**: Milestone 0.5 Reading Tools

---

## 1. Context and Problem Statement

ReflowPress is evolving from a local-first ebook viewer and library into an interactive reading workbench. Users need reading tools:

- In-book full-text search with precision jumping
- Bookmarks attached to reading positions
- Persistent text highlights across EPUB reflow and PDF canvas/text layouts
- Notes associated with highlights or arbitrary publication locations
- Portable export/import of annotations across systems and tools

A critical architectural challenge is **anchoring (locating)** annotations stably across:

1. Dynamic EPUB rendering (changes in font size, viewport dimensions, user themes, or minor publisher markup differences).
2. PDF page layouts (canvas rendering vs. text layer positioning).
3. Application restarts, library rebuilds, and external tool imports/exports.

If annotations rely on brittle DOM XPaths, CSS selectors, or naive character offsets, any window resize or CSS change breaks them. Conversely, relying exclusively on EPUB Canonical Fragment Identifiers (CFI) in our custom sandboxed publication renderer would introduce heavy complexity and high failure rates on non-standard EPUBs.

We must decide on:

1. The locator and anchoring architecture for EPUB and PDF.
2. The storage model and persistence mechanism for user annotations.
3. The portable format for annotation export and import.

---

## 2. Decision Drivers

- **Robustness**: Highlights and bookmarks must survive font changes, window resizing, theme changes, and minor markup updates without getting lost.
- **Portability**: Annotations must be exportable in open, standard-compliant, human-readable formats (JSON, Markdown, HTML) without hardcoded machine-local paths.
- **Non-destructive**: Source EPUB and PDF files must **never** be modified or mutated.
- **Security**: Strict sandboxing (`contextIsolation: true`, `sandbox: true`, no `allow-scripts` in publication iframes). Publication content cannot access or manipulate the annotation bridge.
- **Local-first Performance**: Fast in-session searches without blocking the UI main thread; atomic disk persistence without data corruption.

---

## 3. Evaluated Options

### 3.1 EPUB Anchoring Candidates

| Strategy                                          | Pros                                                                                                       | Cons                                                                                                             | Decision                     |
| :------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------- |
| **A. EPUB CFI Only**                              | Standard EPUB specification fragment identifier                                                            | Fragile across custom renderer DOM wrappers; fails on malformed publisher OPFs/spines; difficult to map into PDF | **Rejected as sole locator** |
| **B. DOM XPath / CSS Path**                       | Direct DOM node targeting                                                                                  | Extremely fragile: breaks on theme class changes, font resizing, or DOM wrapper injection                        | **Rejected**                 |
| **C. TextPosition Selector Only**                 | Compact (character offset start/end)                                                                       | Breaks if whitespace normalization changes or if minor markup alters text flow                                   | **Rejected as sole locator** |
| **D. TextQuote Selector Only**                    | Robust against layout changes; human-readable in export                                                    | Ambiguous if the exact text quote appears multiple times in the same chapter                                     | **Insufficient alone**       |
| **E. Hybrid Selector (W3C Web Annotation Model)** | Combines `sectionHref` + `TextQuoteSelector` (exact, prefix, suffix) + `TextPositionSelector` (start, end) | Slightly larger metadata payload                                                                                 | **Accepted (Primary)**       |

### 3.2 PDF Anchoring Candidates

| Strategy                                             | Pros                                                                             | Cons                                                                       | Decision                    |
| :--------------------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :-------------------------- |
| **A. Page Number Only**                              | Simple                                                                           | Cannot anchor text highlights precisely                                    | **Rejected for highlights** |
| **B. Exact Absolute Canvas Geometry**                | High precision on identical viewport                                             | Breaks on zoom/DPI changes unless normalized; difficult to export portably | **Rejected as primary**     |
| **C. Hybrid Page + TextQuote + Normalized Geometry** | Page-stable; text-searchable; zoom-independent relative coordinates (0.0 to 1.0) | Requires text layer extraction                                             | **Accepted (Primary)**      |

### 3.3 Annotation Persistence Candidates

| Strategy                       | Pros                                                                                                    | Cons                                                                               | Decision                         |
| :----------------------------- | :------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------- | :------------------------------- |
| **A. SQLite via Native Addon** | Powerful relational queries                                                                             | Native ABI compilation risks in Electron across OS platforms (macOS/Windows/Linux) | **Deferred to future milestone** |
| **B. Versioned Atomic JSON**   | Zero native dependencies, battle-tested in Milestone 0.4 Library persistence, atomic write + quarantine | File size grows with thousands of notes (manageable for MVP)                       | **Accepted for Milestone 0.5**   |

---

## 4. Decision Outcome

### 4.1 Hybrid `PublicationLocator` Abstraction

We define a unified `PublicationLocator` domain model in `@reflowpress/annotations`:

```typescript
export type PublicationLocator = EpubPublicationLocator | PdfPublicationLocator;

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextPositionSelector {
  start: number;
  end: number;
}

export interface EpubPublicationLocator {
  kind: "epub";
  sectionHref: string;
  progress?: number; // 0.0 - 1.0 scroll progress within section
  textQuote?: TextQuoteSelector;
  textPosition?: TextPositionSelector;
  structuralHint?: string;
}

export interface PdfPublicationLocator {
  kind: "pdf";
  page: number; // 1-indexed
  zoom?: number;
  textQuote?: TextQuoteSelector;
  textPosition?: TextPositionSelector;
  normalizedRects?: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
}
```

### 4.2 Restoration & Disambiguation Algorithm

When restoring a highlight or note in EPUB:

1. **Position Fast Path**: Attempt match at `textPosition` (character offsets `start` to `end`). If text matches `textQuote.exact`, restoration is immediate.
2. **Context Disambiguation**: If `textPosition` does not match, search the section for occurrences of `textQuote.exact`. Use `prefix` and `suffix` to disambiguate the target occurrence.
3. **Orphan / Unresolved Status**: If the text cannot be found (e.g. publication edition modified), mark the annotation as `status: "orphaned"` rather than silently deleting user data. The user can still view the note and quote in the Reading Tools drawer.

### 4.3 Persistence Architecture

- **Storage Location**: `userData/annotations-v1.json`.
- **Atomic Persistence**:
  1. Serialize to in-memory JSON.
  2. Write to unique temporary file in `userData/` (`annotations-v1.json.tmp.<pid>.<timestamp>`).
  3. Flush file buffer to disk via `handle.sync()`.
  4. Atomically rename temporary file over target file (`rename`).
  5. In case of corruption on read, quarantine corrupted file as `annotations-v1.json.corrupt-<timestamp>` and initialize a clean store.
- **Repository Interface**: `AnnotationRepository` in `@reflowpress/annotations` implemented by `JsonAnnotationRepository` in Electron main process.

### 4.4 Portable Export / Import

- **JSON Export (`reflowpress-annotations` v1)**:
  - Contains publication identity (`identifier`, `title`, `creator`, `format`), format version, and all annotations with locators and timestamps.
  - Strips machine-specific local filesystem paths.
- **Markdown Export**:
  - Structured, human-readable markdown with blockquotes for highlights, timestamps, locations, and user notes.
- **HTML Export**:
  - Self-contained static HTML document with embedded CSS.
  - **Zero external fonts, zero scripts, zero network requests**.
  - All user-supplied text is rigorously HTML-escaped to prevent XSS.
- **JSON Import**:
  - Validates publication identity match (warns or prompts if importing notes for a different book).
  - Handles conflicts by allocating fresh deterministic local IDs and tracking origin import metadata.

---

## 5. Security & Privacy Guarantees

1. **Host-Driven Selection**: Text selection in EPUB is captured via host-side selection listeners on the sandboxed iframe document. No scripts are injected into or executed by the publication iframe (`sandbox="allow-same-origin"` without `allow-scripts`).
2. **Untrusted Data Sanitization**: Imported annotation files are treated as untrusted input. Maximum note body length (64 KB) and maximum total annotation count (10,000) are strictly enforced.
3. **Air-Gapped Guarantee**: Reading tools, search, and annotation export/import operate 100% offline without telemetry, cloud sync, or external HTTP requests.

---

## 6. Consequences

### Positive

- Robust highlight persistence immune to font size and layout changes.
- Safe, non-destructive annotation of EPUB and PDF books.
- Clean separation between core domain (`@reflowpress/annotations`, `@reflowpress/search`) and Electron desktop shell.
- Seamless, portable export to Markdown for note-taking workflows (Obsidian, Notion, Logseq).

### Trade-offs / Limitations

- PDF highlight coordinates rely on text layer availability; non-text scanned PDFs require optical character recognition (deferred to future milestone).
- Cross-library global full-text indexing is intentionally excluded in Milestone 0.5 to keep startup lightweight.
