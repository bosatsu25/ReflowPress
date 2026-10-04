# Changelog

All notable changes to ReflowPress are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-10-04

### Milestone 1.0 — Stable Release Hardening

- **Crash Recovery & Safety**:
  - Implemented `CrashRecoveryManager` tracking `.clean-shutdown` and `.active-session.json` state markers.
  - Added startup Janitor purging orphaned `.tmp-*` atomic staging files.
  - Added non-intrusive `RecoveryBanner` prompting users to resume reading after abnormal terminations.
- **Persistence & Migration Safety**:
  - Implemented `MigrationRunner` and `UpgradeRequiredError` for `library-v1.json`, `reader-state.json`, and `annotations-v1.json`.
  - Future schemas (e.g., version 99) are safely quarantined without data destruction or silent overwrite.
- **Packaging & Distribution**:
  - Configured multi-platform packaging via `electron-builder` producing Windows NSIS installer (`ReflowPress-Setup-1.0.0.exe`), portable binary (`ReflowPress-1.0.0-portable.exe`), macOS DMG/ZIP, and Linux AppImage/DEB.
  - Hardened Electron runtime using `@electron/fuses` (`runAsNode: false`, `onlyLoadAppFromAsar: true`, `enableCookieEncryption: true`).
  - Implemented automated cryptographic checksum generation (`SHA256SUMS.txt`).
- **Performance & Code Splitting**:
  - Split renderer vendor chunks (`pdfjs`, `react-vendor`) reducing initial entry point chunk to ~123 kB (budget < 500 kB).
  - Benchmarked 1,000-book library operations in `JsonLibraryRepository` (< 10 ms load and sort).
- **Public API Contract**:
  - Frozen public API exports across all 16 `@reflowpress/*` workspace packages in `tests/unit/api-contracts.test.ts`.

### Milestone 0.9 — Interoperability & Sync

- **OPDS 2.0 Catalog & Client**:
  - Added built-in OPDS 2.0 Streaming Catalog server binding to loopback (`127.0.0.1`) with RFC 9110 Range request support.
  - Added Remote OPDS client with OPDS 2.0 JSON and OPDS 1.2 Atom XML fallback parsing.
- **Data Sync & Backup**:
  - Added decentralized 3-way merge engine with zero silent data loss (`ConflictRecord`).
  - Added portable `.reflowpress-sync` backup bundle export and selective restore.
  - Added shared sync folder adapter (Syncthing / Dropbox) and WebDAV RFC 4918 adapter with HTTPS enforcement.
- **Hardware E-Reader Transfer**:
  - Added automated device detection for Amazon Kindle, Rakuten Kobo, PocketBook, and generic USB storage.
  - Implemented transactional book copy with SHA-256 integrity verification.
  - Documented explicit MTP capability boundary.
- **Media Overlays (EPUB 3.3)**:
  - Added SMIL 3.0 audio-text synchronization parser (`parseClockValue`, `parseSmilDocument`).

### Milestone 0.8 — Quality & Safe Repair

- **Diagnostic Engine**:
  - Introduced granular rule engine (`EPUB-*` and `PDF-*`) evaluating container, OPF, manifest, spine, navigation, and resource reference graphs.
  - Added PDF Quality Gate profiles (`baseline`, `reader-export`) verifying text layers, geometry bounds, and image presence.
- **Non-Destructive Safe Repair**:
  - Added transactional repair pipeline writing to `<stem>_repaired_<timestamp>.epub`.
  - Added canonical uncompressed `mimetype` restoration, manifest media-type repair, and standard `container.xml` creation.
  - Added pre/post re-inspection verification with automated rollback on regression.
  - Emitted `.provenance.json` sidecar capturing SHA-256 cryptographic provenance.

### Milestone 0.7 — Export Workbench

- **Multi-Format Document Conversion**:
  - Implemented EPUB to PDF conversion via Chromium headless rendering with strict offline network isolation.
  - Implemented standalone HTML export with asset inlining (Data URLs).
  - Implemented GFM Markdown export with YAML frontmatter and ruby text transliteration (`base（reading）`).
- **Export Pipeline**:
  - Implemented deterministic timestamp naming (`<stem>_<YYYYMMDD-HHmmss>.<ext>`) with collision resolution (`-001`..`-999`).
  - Added transactional temporary file writing with atomic promotion.
  - Added headless CLI subcommands (`reflowpress export`).

### Milestone 0.6 — Japanese Typography & Accessibility

- **Japanese Typography**:
  - Added vertical writing mode (`vertical-rl`) with axis-aware keyboard navigation and column paging.
  - Implemented strict Kinsoku Shori line-breaking rules and Tate-chu-yoko alignment.
  - Added native `<ruby>` presentation with phonetics.
- **Accessibility (WCAG 2.2 AA)**:
  - Implemented full keyboard operability with focus trap and focus restoration.
  - Added High Contrast and Forced Colors support across Light, Dark, and Sepia themes.
  - Added polite ARIA live announcements for asynchronous actions.
  - Integrated continuous `@axe-core/playwright` accessibility audits.

### Milestone 0.5 — Reading Tools

- Added hybrid locator annotation model (W3C Web Annotation compliant) supporting highlights, notes, and bookmarks.
- Added in-book search engine for EPUB reflowable text and PDF canvas text layers.
- Added annotation export and import in JSON, Markdown, and HTML formats.

### Milestone 0.4 — Library MVP

- Added recursive directory scanner with incremental mtime indexing and SHA-256 book identity.
- Added responsive Grid and List library views with multi-field search and shelf collections.
- Extracted and cached EPUB cover artwork in user data directory.

### Milestone 0.3 — Reader MVP

- Created desktop workbench shell using Electron 33, React 19, Vite, and PDF.js.
- Added sandboxed EPUB rendering with XHTML sanitization.
- Added native PDF viewing with zoom, page stepping, and fit modes.
- Added atomic reading position persistence (`reader-state.json`).

### Milestone 0.2 — Publication Core

- Implemented `@reflowpress/epub` with shared `loadEpub` loader.
- Normalized EPUB 2 NCX and EPUB 3 Navigation documents into unified navigation trees.
- Implemented safe XHTML extraction, XML well-formedness checks, and DTD defense.

### Milestone 0.1 — Foundation

- Bootstrapped TypeScript monorepo with pnpm workspaces.
- Defined initial domain models (`NormalizedPublication`, `PublicationMetadata`).
- Created initial archive inspection and CI verification pipelines.
