# Compatibility Matrix: Adobe Digital Editions (ADE) vs. ReflowPress

This document benchmarks ReflowPress against its reference reader, **Adobe Digital Editions (ADE) 4.5.x**, defining baseline functional parity targets and highlighting ReflowPress's distinctive advantages as a modern electronic document workbench.

> **Transparency Note**: Facts and planned milestones are kept strictly distinct. Features marked as _Implemented_ represent working code in `main` verified by automated tests. Features marked as _Needs verification_ represent behaviors of the reference reader requiring further empirical confirmation across different OS releases.

## Functional Comparison Matrix

| Capability                  | Reference Reader (ADE 4.5.x)                               | Current ReflowPress (`main`) | Target Milestone | Notes / ReflowPress Differentiation                                                     |
| --------------------------- | ---------------------------------------------------------- | ---------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| **EPUB reading**            | Yes                                                        | No                           | 0.3 (Required)   | Reflowable EPUB viewing in reader interface.                                            |
| **PDF reading**             | Yes                                                        | No                           | 0.3 (Required)   | Fixed-layout PDF viewing and navigation.                                                |
| **EPUB 2 support**          | Yes                                                        | Inspection planning          | 0.2 (Required)   | Compatibility inspection planned; Publication Core will normalize EPUB 2 NCX.           |
| **EPUB 3 support**          | Yes                                                        | Inspector only               | 0.2 (Required)   | Structural inspection implemented; loader & renderer planned.                           |
| **Library catalog**         | Yes                                                        | No                           | 0.4 (Required)   | Local book catalog with cover display and metadata indexing.                            |
| **Collections / Shelves**   | Yes                                                        | No                           | 0.4 (Required)   | User-defined collections, tags, and filtering.                                          |
| **Metadata display**        | Yes                                                        | Inspector partial            | 0.4 (Enhanced)   | Inspector parses Dublin Core; UI will display enriched metadata and health warnings.    |
| **Table of Contents (TOC)** | Yes                                                        | Spine inspection only        | 0.3 (Required)   | Inspector reads spine; reader will provide interactive hierarchical TOC (NCX / Nav).    |
| **Full-text search**        | Yes                                                        | No                           | 0.5 (Enhanced)   | Search scoped across chapter, book, annotations, and whole library with optional RegEx. |
| **Bookmark**                | Yes                                                        | No                           | 0.5 (Required)   | Persistent reading markers stored locally.                                              |
| **Highlight**               | Yes                                                        | No                           | 0.5 (Required)   | Multi-color text highlighting anchored via robust DOM/CFIs.                             |
| **Notes**                   | Yes                                                        | No                           | 0.5 (Required)   | Free-form annotations attached to highlights or pages.                                  |
| **Annotation portability**  | Limited (proprietary sync/export)                          | No                           | 0.5 (Enhanced)   | Export annotations to standard JSON, Markdown, and HTML for PKM integration.            |
| **Printing**                | Yes                                                        | No                           | 0.7 (Planned)    | Physical print driver integration or print via PDF export.                              |
| **Font settings**           | Yes                                                        | No                           | 0.3 (Required)   | User-configurable font family, base size, line height, and margins.                     |
| **Themes (Dark/Light)**     | Limited                                                    | No                           | 0.3 (Enhanced)   | Light, dark, sepia, and high-contrast accessibility themes.                             |
| **Vertical Japanese**       | Yes                                                        | No                           | 0.6 (Required)   | Native `writing-mode: vertical-rl` text layout and paging.                              |
| **Ruby support**            | Yes                                                        | No                           | 0.6 (Required)   | Proper pronunciation guide layout (`<ruby>`, `<rt>`).                                   |
| **Kinsoku shori**           | Yes                                                        | No                           | 0.6 (Required)   | Japanese line-breaking rules (prohibited start/end characters).                         |
| **Right-to-Left (RTL)**     | Yes                                                        | No                           | 0.6 (Planned)    | Bidirectional and RTL script support (Arabic, Hebrew).                                  |
| **MathML**                  | Yes                                                        | No                           | 0.6 (Planned)    | Native mathematical notation rendering.                                                 |
| **Audio / Video media**     | Needs verification (EPUB 3 Media Overlays)                 | No                           | 0.9 (Later)      | Evaluation of media overlays and embedded multimedia.                                   |
| **Accessibility (a11y)**    | Yes (Basic screen-reader hooks)                            | No                           | 0.6 (Required)   | Semantic HTML, ARIA labeling, high-contrast, screen-reader compatibility.               |
| **Keyboard navigation**     | Yes                                                        | No                           | 0.3 (Required)   | Full keyboard controllability for reading, paging, and navigation.                      |
| **EPUB Inspector**          | No / limited                                               | **Yes (Implemented)**        | 0.1 (Advantage)  | Comprehensive ZIP/container/OPF structural diagnostic engine.                           |
| **Broken resource check**   | No / limited                                               | **Yes (Implemented)**        | 0.1 (Advantage)  | Pre-flight validation of manifest targets, archive limits, and path safety.             |
| **EPUB Safe Repair**        | No                                                         | No                           | 0.8 (Advantage)  | Non-destructive, explainable repair of malformed containers and package manifests.      |
| **EPUB → PDF export**       | Not primary (print to PDF workaround)                      | No                           | 0.7 (Advantage)  | High-fidelity publication conversion with CSS Paged Media support.                      |
| **PDF Quality Gate**        | No                                                         | No                           | 0.8 (Advantage)  | Automated verification of PDF openability, text layer, images, and fonts.               |
| **Batch processing**        | Limited / No                                               | No                           | 0.7 (Advantage)  | Headless CLI workflows for bulk inspection, conversion, and repair.                     |
| **Command Line (CLI)**      | No                                                         | Placeholder                  | 0.7 (Advantage)  | Scriptable command-line interface for CI and automation pipelines.                      |
| **Local-first / Offline**   | Partial (Requires Adobe ID / cloud sync for full features) | **Yes (Core Principle)**     | 0.1 (Advantage)  | Zero accounts, zero telemetry, full offline operation by default.                       |

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
