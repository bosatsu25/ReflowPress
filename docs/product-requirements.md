# Product Requirements

## Product Definition

> **ReflowPress is a free, local-first workbench for reading, organizing, inspecting, repairing, searching, annotating, and exporting EPUB and PDF publications.**

ReflowPress provides a reliable, private personal electronic book environment that pairs reading and cataloging with publication inspection, safe repair, and document conversion.

---

## Current Implementation Facts (`main`)

To ensure absolute transparency between implemented features and planned milestones:

### Implemented (Milestones 0.1 Foundation & 0.2 Publication Core)

- TypeScript monorepo with strict typing and pnpm workspaces.
- Continuous Integration (CI) with lint, typecheck, Vitest, and build gates.
- Public workspace packages:
  - `@reflowpress/core`
  - `@reflowpress/epub`
  - `@reflowpress/pdf`
  - `@reflowpress/renderer`
  - `@reflowpress/validation`
- **EPUB Inspector (`inspectEpub`)**:
  - Asynchronous ZIP central directory parsing via `yauzl`.
  - `META-INF/container.xml` inspection and validation.
  - OPF package document parsing via `@xmldom/xmldom` (DTD injection defended).
  - Dublin Core metadata extraction (title, creator, language, identifier).
  - Manifest item extraction and spine reading order extraction.
  - Safety defenses: rejection of directory traversal paths, external entity attacks, and configurable bounds limits on archive size, entry counts, and XML document sizes.
- **Publication Core (`EpubLoader`, `loadEpub`)**:
  - Secure loading of publication content from EPUB 2 and EPUB 3 archives.
  - Shared parsing primitives (archive, XML, path, OPF) eliminating parser duplication.
  - Spine reading order preservation with linear flag mapping (`PublicationSection.linear`).
  - Unified hierarchical navigation normalization for EPUB 3 NavDoc and EPUB 2 NCX (`NavigationItem`).
  - Safe UTF-8 XHTML content extraction with XML well-formedness verification and DTD rejection.
  - Auxiliary resource loading (CSS, images, fonts) into `PublicationResource`.
  - Enriched `NormalizedPublication` and `PublicationMetadata` contracts.
  - DRM and encryption detection (`META-INF/encryption.xml`, `rights.xml`).
  - Configurable resource limits (max archive, entries, metadata, markup, resources, total loaded).
  - Automated test suite: 36 unit tests with 100% pass rate.

### Contracts Defined (Type-Level Only)

- `Renderer` & `VivliostyleRenderer` (renderer interface contracts)
- `PdfDocument` & `PdfValidator` (PDF output and validation contracts)

### Implemented in Milestone 0.3 (Reader MVP)

- EPUB reader interface & reflowable layout engine (`@reflowpress/reader`, `@reflowpress/desktop`)
- Native PDF reader interface (`pdfjs-dist`)
- Desktop application GUI (Electron 33 + React 19 + Vite)
- Table of Contents navigation drawer & keyboard page turning
- Reading position persistence (`reader-state.json`)

### Implemented in Milestone 0.4 (Library MVP)

- `@reflowpress/library` domain package for catalog, filtering, sorting, collections, tags, and repository contract.
- Recursive directory scanning and incremental indexing with stable SHA-256 book identity.
- Cover extraction from EPUB archives and thumbnail caching in `userData/library-cache/covers/`.
- Versioned atomic JSON catalog persistence (`library-v1.json`) with temporary file write, `fsync`, and corrupt file quarantine (`.corrupt-<timestamp>`).
- Desktop Workbench Library view with responsive Grid and List layouts, multi-field search, collection/shelf management, and format categories.
- Round-trip navigation between Library view and Reader MVP.

### Implemented in Milestone 0.5 (Reading Tools)

- `@reflowpress/annotations` domain package for W3C Web Annotation-compliant hybrid locators, highlights, notes, bookmarks, and operations.
- `@reflowpress/search` domain package for in-book full-text search across EPUB and PDF publications with HTML tag stripping, entity decoding, and context snippet extraction.
- Desktop reading tools drawer with Search, Bookmarks, Highlights, and Notes tabs, plus search hit jump navigation.
- Floating selection toolbar for multi-color text highlights (yellow, green, blue, pink) and note attachment.
- Versioned atomic JSON annotation persistence (`annotations-v1.json`) with serialized queue, `fsync`, and corrupt file quarantine (`.corrupt-<timestamp>`).
- Portable PKM annotation export (Markdown, standalone HTML, JSON) and conflict-safe JSON import.

### Implemented in Milestone 0.6 (Japanese Typography & Accessibility)

- `@reflowpress/typography` domain package for CSS Writing Modes, ruby formatting, kinsoku shori, and non-destructive Tate-chu-yoko (TCY).
- Full vertical-rl layout with axis-aware navigation, column progression, and keyboard bindings.
- WCAG 2.2 AA accessibility baseline with polite ARIA live announcements, focus trap/restore dialogs, high-contrast themes, and automated axe-core scanning.

### Implemented in Milestone 0.7 (Export Workbench)

- `@reflowpress/export` domain package for high-fidelity conversion of EPUB to PDF, standalone HTML, and Markdown.
- Headless Chromium PDF rendering via Playwright with CSS Paged Media `@page` layout and Japanese typography reuse.
- Headless CLI (`reflowpress export`) with batch conversion, worker concurrency, and deterministic timestamp naming.

### Implemented in Milestone 0.8 (Quality & Repair)

- `@reflowpress/quality` domain package with rule registry (25+ stable diagnostic rules), resource graph builder, EPUB container/package diagnostics, PDF health diagnostics, and baseline/reader-export quality gates.
- `@reflowpress/repair` domain package with safe repair planner, canonical EPUB ZIP rewriter, transactional staging, regression abort, and `.provenance.json` sidecar generation.
- Desktop Health & Repair modal (`HealthModal`) with tabbed diagnostics, diff previews, live ARIA announcements, and axe-core accessibility compliance.
- Headless CLI subcommands: `reflowpress inspect`, `reflowpress validate`, and `reflowpress repair` (`--apply`, `--provenance`, `--rule`).
- 3-tier golden master regression testing framework and Playwright visual regression suite.

### Implemented in Milestone 0.9 (Interoperability)

- Built-in OPDS 2.0 Catalog feed generator, parser with OPDS 1.2 fallback, and loopback HTTP server with range requests (`@reflowpress/opds`).
- Decentralized 3-way sync engine with zero silent data loss (`ConflictRecord`), deterministic portable IDs, portable backup bundles, shared folder sync, and WebDAV adapter (`@reflowpress/sync`).
- Physical e-reader device detection (Kindle, Kobo, PocketBook, Generic USB), transactional transfers with SHA-256 validation, collision avoidance, and explicit MTP capability boundary (`@reflowpress/device`).
- EPUB 3.3 Media Overlays SMIL 3.0 audio-text synchronization parser (`parseSmilDocument`, `parseClockValue`) and audio reference inspection.
- Headless CLI subcommands: `reflowpress opds`, `reflowpress sync`, `reflowpress backup`, `reflowpress restore`, and `reflowpress device`.
- Desktop Interoperability Workbench modal (`InteroperabilityModal`) with tabbed navigation and WCAG 2.2 AA accessibility.

### Not Implemented (Planned in Future Milestones)

- Production cross-platform installers and auto-updaters (Milestone 1.0)
- Automatic crash recovery and session restoration (Milestone 1.0)
- 1,000+ title high-scale performance benchmarks (Milestone 1.0)

---

## Target Users and Needs

1. **Active Readers**: Need a clean, private, fast reading interface with support for vertical Japanese typography, dark mode, reliable bookmarks, and highlights without forced cloud accounts.
2. **Knowledge Workers & Researchers**: Need to search across personal libraries and export annotations and quotes cleanly to Markdown/JSON for PKM tools (Obsidian, Logseq, Notion).
3. **Publishers & Authors**: Need an inspection and repair tool to verify EPUB package integrity, detect missing assets, and export high-quality, standardized PDFs with automated QA gates.
4. **Developers & Integrators**: Need a clean, modular TypeScript architecture with headless CLI workflows for automated document pipelines.

---

## Functional Requirements by Milestone

### Milestone 0.1: Foundation (Complete)

- [x] TypeScript monorepo with pnpm and strict typing.
- [x] Initial contract definitions for publication, adapters, renderers, and validators.
- [x] High-performance EPUB ZIP container and OPF package inspector.
- [x] Archive safety bounds and malformed entry detection.
- [x] Comprehensive unit tests (22 tests passing).

### Milestone 0.2: Publication Core (Complete)

- [x] Implement `EpubLoader` to securely extract and resolve manifest resources from EPUB 2/3 archives.
- [x] Parse and normalize EPUB 3 Navigation Document (`nav.xhtml`) and EPUB 2 NCX (`toc.ncx`) into a unified hierarchical TOC.
- [x] Resolve internal resource paths (images, fonts, stylesheets) without extracting files to arbitrary disk locations.
- [x] Map loaded content into an enhanced `NormalizedPublication` structure.
- [x] Verify linear spine reading order and non-linear assets.
- [x] Maintain shared parsing primitives between Inspector and Loader.
- [x] Detect DRM/encryption and enforce configurable resource limits.
- [x] Expand automated tests (36 unit tests passing).

### Milestone 0.3: Reader MVP (Complete)

- [x] Render reflowable EPUB chapters in an accessible DOM-based reading viewport.
- [x] Render fixed-layout PDF documents in the viewer.
- [x] Provide an interactive Table of Contents navigation drawer.
- [x] Implement page turning, scroll mode, and keyboard navigation (`ArrowRight`, `ArrowLeft`, `Space`, `PageUp`, `PageDown`).
- [x] Provide customizable font settings (family, size, line-height, margin width).
- [x] Support Light, Dark, and Sepia reading themes.
- [x] Persist the last read location across app restarts.

### Milestone 0.4: Library MVP (Complete)

- [x] Scan local directories for EPUB and PDF publications.
- [x] Extract and cache book covers and Dublin Core metadata.
- [x] Organize publications into user-defined collections, tags, and custom shelves.
- [x] Provide real-time sorting (title, author, recently read, date added) and filtering.
- [x] Store library catalog locally in an embedded, zero-config, versioned atomic JSON repository with corrupt file quarantine.

### Milestone 0.5: Reading Tools (Complete)

- [x] Full-text search within the open publication with highlighted search hit navigation.
- [x] Add, view, and delete local bookmarks.
- [x] Multi-color text selection highlights anchored to robust DOM selectors / EPUB CFIs.
- [x] Attach user notes and annotations to highlights.
- [x] Export annotations to standard JSON, Markdown, and HTML.

### Milestone 0.6: Japanese Typography & Accessibility (Complete)

- [x] Native support for vertical text layout (`writing-mode: vertical-rl`) with vertical column stepping.
- [x] Correct presentation and styling for ruby annotations (`<ruby>`, `<rt>`, `<rp>`) across horizontal and vertical modes.
- [x] Implement Japanese line-breaking rules (Kinsoku shori) and Tate-chu-yoko (TCY) with non-destructive numeral alignment.
- [x] Full keyboard controllability for all library and reader functions, dialog focus trap and restoration.
- [x] Semantic HTML and ARIA labels verified for screen-reader compatibility with polite live announcements.
- [x] Automated accessibility regression suite via `@axe-core/playwright` scanning with 0 critical or serious violations.
- [x] Bidirectional (Bidi) and Right-to-Left (RTL) reading planning and MathML preservation.

### Milestone 0.7: Export Workbench (Complete)

- [x] High-fidelity EPUB to PDF conversion using headless Playwright Chromium and CSS Paged Media `@page` layout with Japanese typography reuse.
- [x] Deterministic PDF output naming:
  ```text
  book.epub           -> book_YYYYMMDD-HHmmss.pdf
  吾輩は猫である.epub -> 吾輩は猫である_YYYYMMDD-HHmmss.pdf
  ```
  Collision resolution: append `-001`, `-002` if multiple conversions occur within the same second, up to `-999`.
- [x] Standalone HTML export with inlined Base64 Data URL assets, `<script>` stripping, and typography CSS injection.
- [x] Clean Markdown export with YAML frontmatter, ruby `<ruby>基底<rt>ふりがな</rt></ruby>` -> `基底（ふりがな）` transliteration, MathML preservation, and companion asset maps.
- [x] Transactional writing staging outputs in temporary files/directories before atomic rename to prevent corruption.
- [x] Batch conversion via headless CLI (`reflowpress export ...`) with bounded worker concurrency (`--jobs <n>`), structured JSON output (`--json`), and partial failure exit codes.

### Milestone 0.8: Quality & Repair (Complete)

- [x] Publication Health Diagnostic Suite: detailed reporting of missing assets, broken internal links, suspicious remote URLs, and malformed tags (`@reflowpress/quality`, 25+ stable diagnostic rules).
- [x] Non-destructive Safe Repair: Inspect → Explain → Preview → Repair → Verify → Undo (`@reflowpress/repair`, canonical ZIP rewriter, transactional staging, regression abort, `.provenance.json`).
- [x] PDF Quality Gate: programmatic assertions checking PDF openability, text layer extractability, font embedding, image presence, and page geometry (`BaselinePdfValidator`, `evaluateQualityGate`).
- [x] 3-tier golden master regression testing framework and Playwright visual regression suite.
- [x] Accessible Desktop Health & Repair UI (`HealthModal`) with live ARIA announcements, explicit textual badges, and diff previews.
- [x] Headless CLI diagnostic subcommands (`reflowpress inspect`, `reflowpress validate`, `reflowpress repair`).

### Milestone 0.9: Interoperability (Complete)

- [x] OPDS 2.0 streaming catalog feed and local loopback server (`@reflowpress/opds`).
- [x] Multi-device 3-way synchronization with zero silent data loss (`@reflowpress/sync`).
- [x] Portable backup bundle export and conflict-resolved restoration.
- [x] Hardware e-reader detection and transactional USB file transfer (`@reflowpress/device`).
- [x] EPUB 3.3 Media Overlays SMIL parser and audio reference metrics.
- [x] Headless CLI interoperability subcommands (`opds`, `sync`, `backup`, `restore`, `device`).
- [x] Accessible Desktop Interoperability Modal with live announcements.

### Milestone 1.0: Stable Release (Next Priority)

- [ ] Production cross-platform installers (Windows, macOS, Linux).
- [ ] Crash recovery and state restoration.
- [ ] Performance benchmarks (< 1s library load for 1,000+ titles).
- [ ] API freeze and backward compatibility guarantees.

---

## Security, Privacy, and DRM Boundaries

- **Local-first & Offline**: 100% of core reader and workbench features must function offline. No accounts or network connections required.
- **Untrusted Input**: All uploaded or imported files are treated as untrusted. Path traversal, entity attacks, and unsafe ZIP entries are blocked before memory allocation.
- **No DRM Circumvention**: ReflowPress does not break or strip DRM. DRM files are safely detected, explained to the user, and treated as unsupported.
- **Zero Telemetry**: No telemetry, tracking analytics, or usage statistics are gathered or transmitted.
- **Non-destructive Writes**: Original source files are immutable by default; repaired books or converted files are written to distinct target paths.
