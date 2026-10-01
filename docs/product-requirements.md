# Product Requirements

## Product Definition

> **ReflowPress is a free, local-first workbench for reading, organizing, inspecting, repairing, searching, annotating, and exporting EPUB and PDF publications.**

ReflowPress provides a reliable, private personal electronic book environment that pairs reading and cataloging with publication inspection, safe repair, and document conversion.

---

## Current Implementation Facts (`main`)

To ensure absolute transparency between implemented features and planned milestones:

### Implemented (Milestone 0.1 Foundation)

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
  - Automated test suite (22 unit tests) with 100% pass rate.

### Contracts Defined (Type-Level Only)

- `NormalizedPublication` (format-neutral publication model contract)
- `PublicationAdapter` & `EpubPublicationAdapter` (adapter interface contracts)
- `Renderer` & `VivliostyleRenderer` (renderer interface contracts)
- `PdfDocument` & `PdfValidator` (PDF output and validation contracts)

### Not Implemented (Planned in Future Milestones)

- EPUB publication content loader (`EpubLoader`)
- EPUB to `NormalizedPublication` adapter logic
- EPUB reader interface & layout engine
- PDF reader interface
- Library catalog & collection management
- Full-text search engine
- Bookmarks, highlights, and note annotations
- Portable annotation export (JSON, Markdown, HTML)
- EPUB to PDF conversion engine
- PDF Quality Gate automated verification
- Desktop application GUI (Electron/Tauri)
- Headless CLI workflow

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

### Milestone 0.2: Publication Core (Next)

- [ ] Implement `EpubLoader` to securely extract and resolve manifest resources from EPUB 2/3 archives.
- [ ] Parse and normalize EPUB 3 Navigation Document (`nav.xhtml`) and EPUB 2 NCX (`toc.ncx`) into a unified hierarchical TOC.
- [ ] Resolve internal resource paths (images, fonts, stylesheets) without extracting files to arbitrary disk locations.
- [ ] Map loaded content into an enhanced `NormalizedPublication` structure.
- [ ] Verify linear spine reading order and non-linear assets.

### Milestone 0.3: Reader MVP

- [ ] Render reflowable EPUB chapters in an accessible DOM-based reading viewport.
- [ ] Render fixed-layout PDF documents in the viewer.
- [ ] Provide an interactive Table of Contents navigation drawer.
- [ ] Implement page turning, scroll mode, and keyboard navigation (`ArrowRight`, `ArrowLeft`, `Space`, `PageUp`, `PageDown`).
- [ ] Provide customizable font settings (family, size, line-height, margin width).
- [ ] Support Light, Dark, and Sepia reading themes.
- [ ] Persist the last read location across app restarts.

### Milestone 0.4: Library MVP

- [ ] Scan local directories for EPUB and PDF publications.
- [ ] Extract and cache book covers and Dublin Core metadata.
- [ ] Organize publications into user-defined collections, tags, and custom shelves.
- [ ] Provide real-time sorting (title, author, recently read, date added) and filtering.
- [ ] Store library catalog locally in an embedded, zero-config database.

### Milestone 0.5: Reading Tools

- [ ] Full-text search within the open publication with highlighted search hit navigation.
- [ ] Add, view, and delete local bookmarks.
- [ ] Multi-color text selection highlights anchored to robust DOM selectors / EPUB CFIs.
- [ ] Attach user notes and annotations to highlights.
- [ ] Export annotations to standard JSON, Markdown, and HTML.

### Milestone 0.6: Japanese Typography & Accessibility

- [ ] Native support for vertical text layout (`writing-mode: vertical-rl`) with vertical paging.
- [ ] Correct positioning for ruby annotations (`<ruby>`, `<rt>`) in horizontal and vertical modes.
- [ ] Implement Japanese line-breaking rules (Kinsoku shori) and Tate-chu-yoko (TCY).
- [ ] Full keyboard controllability for all library and reader functions.
- [ ] Semantic HTML and ARIA labels verified for screen-reader compatibility.
- [ ] Bidirectional (Bidi) and Right-to-Left (RTL) reading planning.

### Milestone 0.7: Export Workbench

- [ ] High-fidelity EPUB to PDF conversion using CSS Paged Media layout.
- [ ] Deterministic PDF output naming:
  ```text
  book.epub           -> book_YYYYMMDD-HHmmss.pdf
  吾輩は猫である.epub -> 吾輩は猫である_YYYYMMDD-HHmmss.pdf
  ```
  Collision resolution: append `-001`, `-002` if multiple conversions occur within the same second.
- [ ] Clean HTML and Markdown export options.
- [ ] Batch conversion via headless CLI (`reflowpress export ...`).

### Milestone 0.8: Quality & Repair

- [ ] Publication Health Diagnostic Suite: detailed reporting of missing assets, broken internal links, suspicious remote URLs, and malformed tags.
- [ ] Non-destructive Safe Repair: Inspect → Explain → Preview → Repair → Verify → Undo.
- [ ] PDF Quality Gate: programmatic assertions checking PDF openability, text layer extractability, font embedding, image presence, and page geometry.
- [ ] Automated visual regression testing suite.

### Milestone 0.9: Interoperability

- [ ] OPDS catalog feed support.
- [ ] Direct e-reader device transfer (USB/MTP).
- [ ] Local sync via standard cloud folders (Syncthing, Dropbox).

### Milestone 1.0: Stable Release

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
