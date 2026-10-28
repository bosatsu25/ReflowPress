# ReflowPress Public API Inventory & Contract Stability Guide

**Date**: October 2026  
**Status**: Frozen for 1.0 Release  
**Verification**: `pnpm test:api` (`tests/unit/api-contracts.test.ts`)

This document defines the frozen public interfaces for the 16 `@reflowpress/*` modular packages. Breaking changes to these signatures are strictly prohibited in 1.x releases.

---

## 1. Domain Package Exports

### `@reflowpress/core`

Foundation contracts and unified publication models:

- `REFLOWPRESS_VERSION`: Canonical release version string.
- Types & Interfaces: `NormalizedPublication`, `PublicationMetadata`, `PublicationSection`, `PublicationResource`, `PublicationAdapter`, `PublicationSource`, `PdfDocument`, `Renderer`, `RenderOptions`, `NavigationItem`.

### `@reflowpress/epub`

EPUB 2 / 3.3 loader, inspector, navigation, and Media Overlays parsers:

- `inspectEpub(sourcePath, limits?)`: Inspects EPUB package structure without full unpack.
- `loadEpub(sourcePath, limits?)`: Extracts normalized publication and metadata.
- `parseNavDocument(html, path)`: Extracts nav structure from EPUB 3 navigation XHTML.
- `parseNcxDocument(xml, path)`: Extracts NCX TOC hierarchy from EPUB 2 NCX.
- `parseSmilDocument(smilXml, path)`: Parses SMIL 3.0 audio-text synchronization segments.
- `parseClockValue(str)`: Converts SMIL timestamps (`12.5s`, `00:01:23.450`) to seconds.
- `EpubLoader`, `DEFAULT_LOADER_LIMITS`, `EpubInspectionError`, `EpubLoadingError`.

### `@reflowpress/pdf`

Lightweight PDF structure inspector:

- `inspectPdfBytes(bytes, sourcePath?)`: Extracts page count, geometry, and version markers without Chromium.

### `@reflowpress/renderer`

Chromium-based headless rendering engine:

- `ChromiumPdfRenderer`: Implements `Renderer` interface to compile normalized publications to PDF using Playwright Chromium.

### `@reflowpress/typography`

Bilingual (Japanese/English) CSS generator and typography utilities:

- `generateTypographyCss(settings, options)`: Emits isolated CSS with CSS Writing Modes (`vertical-rl` / `horizontal-tb`), strict kinsoku line breaking, ruby styling, and color themes.
- `normalizeLegacyEpubCss(css)`: Strips vendor prefixes (`-epub-writing-mode`, `-epub-ruby-position`) into standard modern CSS.
- `applyTcyAssist(markup, mode)`: Wraps 1-2 digit ASCII numerals in vertical text with `<span class="reflowpress-tcy">`.
- `removeTcySpans(markup)`: Reverses TCY markup safely preserving text.
- `resolveWritingMode(requested, context)`: Resolves auto/vertical/horizontal modes.
- `DEFAULT_JAPANESE_TYPOGRAPHY_SETTINGS`.

### `@reflowpress/reader`

Reading progress calculations, bounds clamping, and navigation logic:

- `clampFontSize`, `clampLineHeight`, `clampMargin`, `clampProgress`: Parameter boundary guards.
- `getNextSectionIndex`, `getPreviousSectionIndex`, `findSectionIndexByHref`: Section transitions.
- `clampPdfPage`, `clampPdfZoom`: PDF canvas viewport navigation.
- `DEFAULT_READER_SETTINGS`, `DEFAULT_FONT_SIZE`, `DEFAULT_LINE_HEIGHT`, `DEFAULT_MARGIN`.

### `@reflowpress/search`

Full-text in-book search engines:

- `searchEpubSections(pubId, sections, query, options?, onProgress?, abortSignal?)`: Case-insensitive regex search with word boundaries and snippet extraction.
- `searchPdfPages(pubId, pages, query, options?, onProgress?, abortSignal?)`: PDF page-level text search.
- `extractVisibleText(html)`: Strips markup for searchable text.
- `createSearchSnippet(text, matchStart, matchEnd, length?)`: Extracts context windows.

### `@reflowpress/annotations`

Annotations domain model, W3C Web Annotation locators, and export/import:

- `createBookmark`, `createHighlight`, `createNote`: Factory functions for reader annotations.
- `filterAnnotations`, `searchAnnotations`: In-memory querying.
- `exportAnnotationsToJson`, `importAnnotationsFromJson`: Portable JSON format.
- `exportAnnotationsToMarkdown`: Human-readable Markdown export.
- `matchTextQuote(content, selector, hintPosition?)`: W3C TextQuoteSelector fuzzy matcher with prefix/suffix context scoring.

### `@reflowpress/library`

Catalog state operations, collections, and tag normalization:

- `createDefaultCatalog`: Initializes empty catalog store.
- `addBookToCatalog`, `updateBookInCatalog`, `removeBookFromCatalog`: Immutable catalog modifications.
- `filterBooks`, `sortBooks`: Multi-attribute filtering and sorting.
- `createCollection`, `deleteCollection`, `addBookToCollection`, `removeBookFromCollection`: Custom collections.
- `normalizeTag`: Lowercase trimmed tag hygiene.

### `@reflowpress/export`

Publication export pipeline to PDF, standalone HTML, and Markdown:

- `exportPublication(pub, options)`: Single publication export.
- `exportBatch(jobs, options)`: Multi-worker batch orchestrator with concurrency control.
- `generateDeterministicFilename(options)`: Deterministic timestamps with collision resolution (`-001`).
- `sanitizeStem(stem)`: Cross-platform filesystem-safe filename stems preserving Unicode.
- `exportToHtml`, `exportToMarkdown`, `exportToPdf`: Discrete format exporters.

### `@reflowpress/quality`

Diagnostic rule engine and health inspection:

- `inspectEpubHealth(sourcePath, options?)`: Automated container, OPF, manifest, resource, and Media Overlays inspection.
- `inspectPdfHealth(bytes, sourcePath?)`: PDF page structure, geometry, and image layer analysis.
- `evaluateQualityGate(report, profile)`: Pass/Fail gate evaluation against baseline or custom profiles.
- `sortFindings`, `deduplicateFindings`: Deterministic findings ordering.
- `RULE_REGISTRY`, `getRuleDefinition`: Catalog of diagnostic rules.

### `@reflowpress/repair`

Safe, non-destructive publication repair engine:

- `planRepairs(report)`: Calculates safe automated repair actions.
- `executeRepair(sourcePath, plan, options)`: Non-destructive repair using staging `.tmp-*` and atomic commit.
- `buildCanonicalEpubZip(entries)`: Constructs compliant EPUB archives with uncompressed mimetype.

### `@reflowpress/validation`

PDF output quality verification:

- `BaselinePdfValidator`: Headless verification of generated PDF documents.

### `@reflowpress/opds`

OPDS 2.0 catalog generator, Atom XML fallback, and read-only HTTP server:

- `generateOpds2Catalog(options)`: Readium WebPub Manifest catalog generator.
- `mapBookToPublication(book, baseUrl)`: Transforms local catalog book into OPDS publication.
- `parseOpdsFeed(content, contentType?)`: Dual-format JSON / XML feed parser.
- `OpdsServer`: Read-only HTTP server supporting byte-range streaming (`206 Partial Content`).
- `fetchRemoteOpdsFeed(url, options?)`: SSRF-protected remote feed fetcher.
- `validateSafeUrl(url)`: URL scheme and security guard.

### `@reflowpress/sync`

Multi-device sync engine, portable bundles, and 3-way merge:

- `DEFAULT_SYNC_LOCK_TIMEOUT_MS`: 15-minute lease lock expiration.
- `FolderSyncAdapter`: Atomically reads/writes portable sync bundles to shared directories.
- `WebdavSyncAdapter`: RFC 4918 remote storage sync.
- `computePortablePublicationId(book)`: Content-based SHA-256 identifier.
- `mergeSnapshots(base, local, remote)`: 3-way merge conflict detector.
- `serializeSyncBundle`, `deserializeSyncBundle`: Portable JSON serialization.
- `createRestorePlan`, `applyRestore`: Safe backup restoration.

### `@reflowpress/device`

E-reader USB Mass Storage adapter and profile detection:

- `detectDeviceProfile(rootPath)`: Identifies Kobo, Kindle, PocketBook, or Generic devices.
- `KNOWN_PROFILES`: Directory layout and supported format specifications.
- `FilesystemDeviceAdapter`: File copy with free space preflight and SHA-256 verification.
- `MtpDeviceAdapter`: Interface boundary for deferred MTP transport.

---

## 2. API Contract Verification

Run the contract verification suite at any time:

```bash
pnpm test:api
```
