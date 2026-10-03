# ADR 0007: Export Rendering Pipeline, Multi-Format Serialization, and Headless CLI Architecture

- **Status**: Accepted
- **Date**: 2026-10-03
- **Deciders**: ReflowPress Core & Architecture Team
- **Context**: Milestone 0.7 Export Workbench

---

## 1. Context and Problem Statement

Milestone 0.7 aims to transform ReflowPress into an offline-first **Export Workbench**, enabling users to convert EPUB electronic publications into high-fidelity PDF documents, standalone self-contained HTML files, and clean Markdown archives for personal knowledge management (PKM).

Key technical challenges and constraints:

1. **Publication Core Reuse**: We must NOT write a secondary EPUB parser. Both Reader and Exporter must strictly operate on the existing `NormalizedPublication` produced by `loadEpub()`.
2. **Typography Engine Reuse**: Japanese typography rules (vertical writing `vertical-rl`, ruby, kinsoku shori, tate-chu-yoko) established in Milestone 0.6 via `@reflowpress/typography` must be preserved identically in exported output.
3. **Renderer Evaluation & License Gate**: The PDF rendering engine must operate headless in CI and CLI environments, offline without silent network fetches, execute safely without running untrusted scripts, and avoid copyleft licenses (such as AGPL-3.0) that would restrict ReflowPress's permissive distribution.
4. **Deterministic and Collision-Safe Output**: Output files must follow predictable naming schemes (`<basename>_<YYYYMMDD-HHmmss>.<ext>`) with deterministic collision resolution (`-001`, `-002`), injectable clocks for reproducible testing, and transactional writes to prevent corrupt partial output.
5. **Multi-Format Serialization**:
   - **HTML**: Must be a single self-contained document with safe inlined data URIs, semantic markup, and zero network dependencies or scripts.
   - **Markdown**: Must maintain reading order, extract images to a companion asset folder, provide a clear policy for ruby and MathML, and operate transactionally.
6. **Headless CLI Interface**: A clean, scriptable command-line interface in `apps/cli` supporting batch operations, directory traversal, bounded concurrency, machine-readable JSON reports, and typed exit codes.

---

## 2. Decision Drivers

- **Zero Duplicate EPUB Parsing**: Use `loadEpub()` from `@reflowpress/epub` as the sole ingestion gateway.
- **License Integrity**: Prohibit AGPL-3.0 dependencies; maintain permissive MIT/Apache-2 compatibility.
- **Strict Network Isolation**: The export engine must never fetch `http://` or `https://` resources. Remote links in markup are omitted or handled safely.
- **Publication Immutability**: The original publication files are never modified in place.
- **Atomic Transactional Output**: Render to temporary files first, validate basic structure, then atomically rename/move. On failure, all temporary artifacts are removed.
- **Boundary Separation**: Keep pure export domain logic in `@reflowpress/export`, rendering in `@reflowpress/renderer`, and CLI user interaction in `apps/cli`.
- **Honest Quality Claims**: Milestone 0.7 focuses on structural correctness and basic sanity validation. Full PDF Quality Gate (font audits, visual regression, PDF/A, PDF/UA) is reserved for Milestone 0.8.

---

## 3. Evaluated Decisions

### 3.1 PDF Rendering Engine Comparison

We evaluated five candidate architectures for rendering HTML / CSS Paged Media to PDF:

| Option       | Technology                             | CSS Paged Media & Vertical Japanese                                                                                         | Headless / Offline / Automation                                            | License & Distribution                                                       | Decision                                                                         |
| :----------- | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| **Option A** | **Vivliostyle Core / CLI**             | Excellent CSS Paged Media; good Japanese support                                                                            | Requires Puppeteer; high resource usage                                    | **AGPL-3.0 Copyleft** (Strict viral requirement on ReflowPress distribution) | **Rejected** (License incompatibility)                                           |
| **Option B** | **Paged.js**                           | Partial CSS Paged Media polyfill                                                                                            | Runs in browser/Node via DOM slicing                                       | MIT                                                                          | **Rejected** (DOM fragmentation causes severe bugs in `vertical-rl` column flow) |
| **Option C** | **wkhtmltopdf / WeasyPrint**           | Legacy WebKit / Python based                                                                                                | External system binaries required                                          | LGPL / GPL                                                                   | **Rejected** (Outdated CSS, missing modern Writing Modes & ruby)                 |
| **Option D** | **Electron Headless (`printToPDF`)**   | Full Chromium support                                                                                                       | Requires Electron runtime; heavy in pure CLI                               | MIT                                                                          | **Viable alternative**, but heavier for headless server CLI                      |
| **Option E** | **Playwright Chromium (`page.pdf()`)** | Full Chromium CSS Writing Modes (`vertical-rl`), CSS Text 3 (`line-break: strict;`), HTML5 `<ruby>`, `@page` size & margins | 100% headless, fast launch, script blocking, route aborting, deterministic | **Apache-2.0** (Permissive, zero copyleft conflicts)                         | **Accepted**                                                                     |

**Decision**: We adopt **Option E: Playwright Chromium** (`ChromiumPdfRenderer`).

- **Why**: Chromium natively implements modern CSS Writing Modes (`vertical-rl`), HTML5 `<ruby>`, CSS Text Level 3 kinsoku rules, and `@page` rules (`size: A4; margin: 20mm;`).
- **License**: Apache-2.0 ensures no copyleft restrictions.
- **Security**: In headless Chromium, we disable JavaScript execution (`javaScriptEnabled: false`) and intercept/abort all network requests via route aborting, ensuring total offline safety.
- **Existing Alignment**: Playwright is already our tested end-to-end foundation.

### 3.2 Typography Engine Reuse (`@reflowpress/typography`)

- Rather than duplicating CSS rules or using Reader UI styles (which contain viewport scrollers and drawer styles), Exporter utilizes:
  - `@reflowpress/typography`: `generateTypographyCss()`, `normalizeLegacyEpubCss()`, and `applyTcyAssist()`.
  - Dedicated **Print Media Stylesheet**: `@page` geometry, `break-before: page;`, `break-inside: avoid;`, page margins, and print color adjustments.

### 3.3 Multi-Format Serialization Architecture

#### A. Standalone HTML Exporter (`HtmlExporter`)

- Combines chapters in spine reading order into a single clean semantic HTML5 document.
- Inlines local publication assets (images, SVGs, stylesheets) as Base64 Data URLs with configurable size thresholds (up to 16 MiB per publication).
- Strips `<script>`, inline event handlers (`onload`, `onclick`), and `javascript:` URLs.
- Preserves semantic tags (`article`, `section`, `h1`-`h6`, `table`, `ruby`, `rt`, `rp`, `math`) and text directions (`lang`, `dir`).

#### B. Markdown Exporter (`MarkdownExporter`)

- Converts HTML AST into clean CommonMark/GFM markdown preserving heading hierarchy, blockquotes, lists, code, tables, and images.
- **Asset Strategy**: Does not bloat single `.md` files with huge data URIs. Instead, writes `<source-basename>_<timestamp>.md` and a companion asset directory `<source-basename>_<timestamp>_assets/`.
- **Ruby Handling**: Standard Markdown lacks native ruby syntax. ReflowPress adopts the standard readability convention: `base（reading）` (e.g. `夏目漱石（なつめそうせき）`), ensuring pronunciation data is never silently dropped.
- **MathML Handling**: Preserves raw `<math>` tags in markdown output with an explicit warning about terminal viewer limitations.
- **Transaction**: Markdown file and asset folder are prepared in a temporary directory and atomically moved together.

#### C. PDF Exporter (`PdfExporter`)

- Generates print-ready HTML, feeds it to `ChromiumPdfRenderer`, captures the generated PDF buffer, runs basic sanity validation, and atomically commits the file.

### 3.4 Deterministic Output Naming & Collision Policy

- **Format**: `<basename>_<YYYYMMDD-HHmmss>.<ext>` (e.g. `book_20261003-153012.pdf`, `吾輩は猫である_20261003-153012.pdf`).
- **Character Safety**: Sanitizes invalid filesystem characters (`:`, `*`, `?`, `"`, `<`, `>`, `|`, `/`, `\`) while preserving Unicode/Japanese characters.
- **Collision Resolution**: If a file with the target name exists (and `--overwrite` is not set), appends `-001`, `-002`, ..., up to `-999`.
- **Testability**: Accepts an injectable clock function `now: () => Date` (supporting `SOURCE_DATE_EPOCH` in CI) to ensure byte-deterministic and timestamp-deterministic tests.

### 3.5 Output Transaction & Fault Tolerance

1. Writes output to a temporary staging path in the user's OS temp directory (`reflowpress-export-<uuid>/`).
2. Performs basic sanity validation (non-empty bytes, `%PDF-` signature, page count > 0).
3. Atomically moves / renames the staged file(s) to the destination.
4. On error, deletes the temporary staging directory and leaves the destination directory untouched.

### 3.6 Baseline PDF Sanity Gate (Milestone 0.7 Scope)

- Milestone 0.7 implements baseline sanity checks:
  1. File exists and has non-zero byte size.
  2. Starts with standard `%PDF-` signature.
  3. PDF header and xref table can be read and report page count > 0.
  4. Renderer reported zero unhandled exceptions.
- **Explicit Non-Goals**: Full automated font embedding audits, visual regression diffing, PDF/A (ISO 19005) or PDF/UA (ISO 14289) conformance validation are explicitly deferred to Milestone 0.8.

### 3.7 CLI Architecture (`apps/cli`)

- CLI entry point `reflowpress export [files...]`.
- Options: `--format <pdf|html|markdown|all>`, `--output-dir <path>`, `--page-size <A4|A5|B5|Letter>`, `--margin <margin>`, `--writing-mode <auto|horizontal|vertical>`, `--jobs <n>`, `--overwrite`, `--recursive`, `--json`, `--quiet`.
- Graceful cancellation handling for `SIGINT` (Ctrl+C).
- Typed exit codes:
  - `0`: Success
  - `1`: General / operational error
  - `2`: Invalid CLI arguments or options
  - `3`: Input file not found or unsupported
  - `4`: DRM protected publication
  - `5`: Partial batch export failure

---

## 4. Consequences and Compliance

### Positive

- Unified publication ingestion: zero divergence between Reader and Exporter.
- Standards-based typography reuse from `@reflowpress/typography`.
- Complete license safety (Apache-2 / MIT; zero AGPL risks).
- Full offline operation with strict network blocking and script disabling.
- Predictable, transactional file output.

### Negative / Trade-offs

- Headless Chromium requires Chromium binaries (already present via Playwright in the dev/CI environment).
- Fixed-layout EPUB documents will render as pre-paginated pages without advanced reflow.
- Complex MathML in Markdown relies on inline HTML `<math>` tags, which may render as raw markup in minimal terminal viewers.
