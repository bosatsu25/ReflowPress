# Compatibility Matrix: Adobe Digital Editions (ADE) vs. ReflowPress

This document benchmarks ReflowPress against its reference reader, **Adobe Digital Editions (ADE) 4.5.x**, defining baseline functional parity targets and highlighting ReflowPress's distinctive advantages as a modern electronic document workbench.

> **Transparency Note**: Facts and planned milestones are kept strictly distinct. Features marked as _Implemented_ represent working code in `main` verified by automated tests. Features marked as _Needs verification_ represent behaviors of the reference reader requiring further empirical confirmation across different OS releases.

## Functional Comparison Matrix

| Capability                   | Reference Reader (ADE 4.5.x)                               | Current ReflowPress (`main`)     | Target Milestone | Notes / ReflowPress Differentiation                                                                               |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **EPUB reading**             | Yes                                                        | **Yes (Implemented in 0.3)**     | 0.3 (Required)   | Reflowable EPUB viewing in reader interface.                                                                      |
| **PDF reading**              | Yes                                                        | **Yes (Implemented in 0.3)**     | 0.3 (Required)   | Fixed-layout PDF viewing and navigation.                                                                          |
| **EPUB 2 support**           | Yes                                                        | **Yes (Implemented in 0.2)**     | 0.2 (Required)   | Normalizes EPUB 2 NCX, OPF, and content documents.                                                                |
| **EPUB 3 support**           | Yes                                                        | **Yes (Implemented in 0.2)**     | 0.2 (Required)   | Structural inspection, NavDoc normalization, and content loading.                                                 |
| **Library catalog**          | Yes                                                        | **Yes (Implemented in 0.4)**     | 0.4 (Required)   | Local book catalog with cover display and metadata indexing.                                                      |
| **Collections / Shelves**    | Yes                                                        | **Yes (Implemented in 0.4)**     | 0.4 (Required)   | User-defined collections, tags, and filtering.                                                                    |
| **Metadata display**         | Yes                                                        | **Yes (Implemented in 0.4)**     | 0.4 (Enhanced)   | Inspector parses Dublin Core; Library UI displays enriched metadata.                                              |
| **Table of Contents (TOC)**  | Yes                                                        | **Yes (Implemented in 0.3)**     | 0.3 (Required)   | Interactive hierarchical TOC drawer for EPUB (NavDoc / NCX).                                                      |
| **Full-text search**         | Yes                                                        | **Yes (Implemented in 0.5)**     | 0.5 (Enhanced)   | In-book streaming search across EPUB sections and PDF pages with snippet previews.                                |
| **Bookmark**                 | Yes                                                        | **Yes (Implemented in 0.5)**     | 0.5 (Required)   | Persistent reading markers with jump-to-location and hotkey support (`Ctrl+D`).                                   |
| **Highlight**                | Yes                                                        | **Yes (Implemented in 0.5)**     | 0.5 (Required)   | Multi-color text highlighting anchored via W3C Web Annotation hybrid selectors.                                   |
| **Notes**                    | Yes                                                        | **Yes (Implemented in 0.5)**     | 0.5 (Required)   | Free-form annotations attached to highlights or chapters.                                                         |
| **Annotation portability**   | Limited (proprietary sync/export)                          | **Yes (Implemented in 0.5)**     | 0.5 (Enhanced)   | Export annotations to standard JSON, Markdown, and HTML for PKM integration.                                      |
| **Printing**                 | Yes                                                        | No                               | 0.7 (Planned)    | Physical print driver integration or print via PDF export.                                                        |
| **Font settings**            | Yes                                                        | **Yes (Implemented in 0.3)**     | 0.3 (Required)   | User-configurable font family, base size, line height, and margins.                                               |
| **Themes (Dark/Light)**      | Limited                                                    | **Yes (Implemented in 0.3)**     | 0.3 (Enhanced)   | Light, dark, and sepia reader themes.                                                                             |
| **Vertical Japanese**        | Yes                                                        | **Yes (Implemented in 0.6)**     | 0.6 (Required)   | Native `writing-mode: vertical-rl` text layout, author-priority with user override, and axis-aware navigation.    |
| **Ruby support**             | Yes                                                        | **Yes (Implemented in 0.6)**     | 0.6 (Required)   | Native `<ruby>`, `<rt>`, `<rp>` styling and preservation across horizontal and vertical modes.                    |
| **Kinsoku shori**            | Yes                                                        | **Yes (Implemented in 0.6)**     | 0.6 (Required)   | JIS X 4051-aligned CSS Text strict line-breaking (`line-break: strict;`) and non-destructive Tate-chu-yoko.       |
| **Right-to-Left (RTL)**      | Yes                                                        | **Yes (Foundation in 0.6)**      | 0.6 (Planned)    | Bidirectional and RTL script preservation (`dir="rtl"`) with isolated text spans.                                 |
| **MathML**                   | Yes                                                        | **Yes (Foundation in 0.6)**      | 0.6 (Planned)    | Native mathematical notation rendering preserved without sanitizer stripping.                                     |
| **Audio / Media Overlays**   | Needs verification (EPUB 3 Media Overlays)                 | **Yes (Implemented in 0.9)**     | 0.9 (Enhanced)   | EPUB 3.3 SMIL 3.0 audio-text synchronization parser and audio asset inspection.                                   |
| **OPDS 2.0 Streaming**       | No                                                         | **Yes (Implemented in 0.9)**     | 0.9 (Advantage)  | Built-in OPDS 2.0 catalog and loopback HTTP server with RFC 9110 byte-range streaming for mobile readers.         |
| **Multi-device Sync**        | Limited (proprietary Adobe cloud sync)                     | **Yes (Implemented in 0.9)**     | 0.9 (Advantage)  | Decentralized 3-way merge sync via Syncthing, Dropbox, or WebDAV with zero silent data loss.                      |
| **E-reader Device Transfer** | Yes (USB Mass Storage for ADE-licensed devices)            | **Yes (Implemented in 0.9)**     | 0.9 (Advantage)  | Hardware detection and transactional transfer for Kindle, Kobo, PocketBook, and USB drives with SHA-256 verify.   |
| **Accessibility (a11y)**     | Yes (Basic screen-reader hooks)                            | **Yes (Implemented in 0.6)**     | 0.6 (Required)   | WCAG 2.2 AA baseline: full keyboard navigation, focus trap/restore, polite ARIA live alerts, axe-core tested.     |
| **Keyboard navigation**      | Yes                                                        | **Yes (Implemented in 0.3/0.6)** | 0.3 (Required)   | Axis-aware arrow/page keyboard navigation, modal focus trap, and global shortcut keys.                            |
| **EPUB Inspector**           | No / limited                                               | **Yes (Implemented)**            | 0.1 (Advantage)  | Comprehensive ZIP/container/OPF structural diagnostic engine.                                                     |
| **Broken resource check**    | No / limited                                               | **Yes (Implemented)**            | 0.1 (Advantage)  | Pre-flight validation of manifest targets, archive limits, and path safety.                                       |
| **EPUB Safe Repair**         | No                                                         | **Yes (Implemented in 0.8)**     | 0.8 (Advantage)  | Non-destructive, explainable repair of malformed containers and package manifests with diff preview & provenance. |
| **EPUB → PDF export**        | Not primary (print to PDF workaround)                      | **Yes (Implemented in 0.7)**     | 0.7 (Advantage)  | High-fidelity publication conversion with CSS Paged Media support and Japanese typography.                        |
| **PDF Quality Gate**         | No                                                         | **Yes (Implemented in 0.8)**     | 0.8 (Advantage)  | Automated verification of PDF openability, text layer, images, and fonts via `@reflowpress/quality`.              |
| **Batch processing**         | Limited / No                                               | **Yes (Implemented in 0.7)**     | 0.7 (Advantage)  | Headless CLI workflows for bulk inspection, conversion, and export with bounded concurrency.                      |
| **Command Line (CLI)**       | No                                                         | **Yes (Implemented in 0.7)**     | 0.7 (Advantage)  | Scriptable command-line interface (`reflowpress export`, `inspect`, `repair`, `opds`, `sync`, `device`).          |
| **Local-first / Offline**    | Partial (Requires Adobe ID / cloud sync for full features) | **Yes (Core Principle)**         | 0.1 (Advantage)  | Zero accounts, zero telemetry, full offline operation by default.                                                 |

## Detailed Breakdown of Reference Discrepancies

### Adobe Digital Editions (ADE) 4.5.x Characteristics

- **DRM Centricity**: Built primarily as an authorized reading system for Adobe Content Server (ACS) DRM, often requiring an Adobe ID or vendor authentication.
- **Closed Ecosystem**: Annotation sync is tied to proprietary protocols; user data is not easily exported to standard Markdown or JSON.
- **Black-box Error Handling**: Corrupted or non-standard EPUB files typically fail to open with obscure error codes, offering no diagnostics or remediation paths.
- **No Production Automation**: ADE lacks a scriptable CLI or automated batch conversion capabilities for publishing workflows.

### ReflowPress Workbench Innovations

1. **Diagnostic Transparency**: Instead of silently failing, ReflowPress identifies broken manifests, missing image targets, invalid spine references, and unescaped entity bugs using its built-in Inspector.
2. **First-class Japanese Typography**: ReflowPress places first-class emphasis on vertical text (`vertical-rl`), ruby annotation, and line-breaking constraints (kinsoku), which are critical for Japanese digital publications.
3. **Dual Role (Reader + Exporter)**: Rather than running separate parsing engines for reading and conversion, ReflowPress unifies them under a single **Publication Core**.
4. **Data Sovereignty**: Books, highlights, annotations, reading progress, and repair diffs are completely owned by the user and stored in open formats.
