# ADR 0008: Quality Diagnostic Engine, Safe Repair, and Output Quality Gate

- **Status**: Accepted
- **Date**: 2026-10-03
- **Deciders**: ReflowPress Core Team
- **Consulted**: JSTQB Quality Assurance Principles, EPUB 3.3 Specification, ISO 32000-2 (PDF 2.0), W3C Web Accessibility Guidelines

---

## 1. Context and Problem Statement

ReflowPress aims to be more than a simple reader or format converter: it is an offline, local-first electronic publication workbench. Real-world electronic publications (EPUB and PDF) often suffer from structural defects, including missing container declarations, unindexed manifest assets, broken internal navigation links, malformed media types, invalid text encoding, and corrupt text layers.

In Milestone 0.7, ReflowPress implemented format conversion (`@reflowpress/export`) with a baseline PDF check (`BaselinePdfValidator`). However, Milestone 0.8 requires transforming ReflowPress into a rigorous **Publication QA Workbench**.

Key challenges:

1. **Separation of Quality Inspection and Repair**: A critical anti-pattern in document tools is "silent repair" or mutation during loading (`if (broken) fix()`). Such mutations lead to silent corruption, invalidation of user annotations, and unpredictable behavior.
2. **Deterministic Diagnostic Rules**: Diagnostic findings must be categorized, reproducible, and identified by stable, human-readable IDs rather than arbitrary error strings.
3. **Safe, Non-Destructive Repair**: Only issues with mathematically and syntactically unambiguous resolutions must be automatically repaired. ReflowPress must never invent metadata (titles, authors) or arbitrarily delete unreferenced assets ("orphans") that might contain valuable illustrations or data.
4. **Output PDF Quality Gate**: Generated PDFs must be verified programmatically for openability, text layer extractability, page geometry consistency, and image presence.
5. **Regression Verification**: Regression testing must not rely on fragile byte-level PDF comparisons or unversioned visual snapshots.

---

## 2. Decision Drivers

- **Core Product Principle**: _Never silently corrupt a publication_. Factual diagnostics must always precede remediation.
- **Inspect → Explain → Preview → Safe Repair → Re-inspect**: The complete QA loop must be formal, observable, and reversible.
- **Zero Copyleft Contamination & Offline Independence**: No mandatory external runtime dependencies (such as requiring a Java runtime environment for EPUBCheck, or heavy native binaries).
- **Format-Neutral Quality Architecture**: Quality finding and reporting structures should be shared between EPUB and PDF where applicable, with format-specific evidence and rules cleanly separated.
- **Cross-Platform Determinism**: Identical diagnostic and repair behavior on Windows (CRLF, backslashes) and POSIX systems (LF, forward slashes).

---

## 3. Evaluated Options and Considered Alternatives

### 3.1 EPUB Validation Engine

- **Option A (EPUBCheck via Java subprocess)**: Call the official W3C EPUBCheck CLI tool.
  - _Pros_: Complete standard conformance checking.
  - _Cons_: Requires an installed Java runtime (JRE >= 11), heavyweight jar distribution (~20MB), slow subprocess startup, impossible in constrained offline environments without Java.
- **Option B (Pure Native Diagnostic Rule Engine in TypeScript)**: Implement a layered, modular rule engine using existing ReflowPress archive and XML parsing primitives.
  - _Pros_: Zero external runtime dependencies, 100% cross-platform, instant execution, deeply integrated with ReflowPress data models and safe repair actions.
  - _Cons_: Must specify and maintain our own diagnostic rule catalog.
- **Selected**: **Option B as primary engine**, with **Option A documented as an optional external adapter**. ReflowPress operates out of the box with its native diagnostic suite without requiring Java.

### 3.2 Safe Repair Scope and Whitelist

- **Aggressive Auto-Fix (Rejected)**: Auto-deleting unreferenced ("orphan") files, generating synthetic book titles from file names, or aggressively reformatting all XHTML.
  - _Risk_: Data loss, invalidating author intentions, and silent alteration of book content.
- **Safe-Only Deterministic Repair (Selected)**:
  - Whitelist only strictly safe actions:
    1. **Canonical EPUB Mimetype Repair**: Ensuring `mimetype` is uncompressed at byte offset 38 with exactly `application/epub+zip`.
    2. **Unambiguous Manifest Media-Type Correction**: Fixing media-type declarations when file extension and content unambiguously define the MIME type (`.xhtml`, `.css`, `.png`, `.jpg`, `.svg`).
    3. **Container XML Repair**: Adding or normalizing a missing canonical `META-INF/container.xml` pointing to the single existing OPF document.
  - Classify content deletions and metadata additions as **REVIEW** or **MANUAL** only.

### 3.3 PDF Quality Gate Architecture

- **Raw Byte Hash Matching (Rejected)**: Comparing output PDF MD5/SHA256 hashes against golden masters. Fails due to embedded PDF creation timestamps and object stream compression variance.
- **Multi-Level Semantic Inspection (Selected)**:
  1. **Openability & Structure**: Parser opens document without fatal error; page count > 0; trailer and catalog valid.
  2. **Extractable Text Layer**: Programmatic inspection via PDF.js `getTextContent()`, asserting non-empty text, reasonable replacement character ratio, and Japanese glyph extraction.
  3. **Page Geometry**: Per-page width, height, and orientation bounds checking (flagging zero, inverted, or extreme page aspect ratios).
  4. **Image & Resource Presence**: Verification of raster content via operator list evaluation where stably supported.

### 3.4 Golden Master & Regression Strategy

- **3-Tier Golden Master Framework**:
  1. **Structural Golden**: JSON snapshot containing page counts, page dimensions, finding IDs, and metadata schema.
  2. **Textual Golden**: Normalized plain text extraction (whitespace and newline normalized) verifying complete Japanese and Latin character retention.
  3. **Visual Regression**: Playwright screenshot diffing on fixed-size canvas viewports for representative pages (horizontal Japanese, vertical-rl layout, ruby annotations) with strict pixel threshold and manual update script (`pnpm test:visual:update`).

---

## 4. Architectural Design

```mermaid
flowchart TD
    SUBGRAPH_INSPECT[Quality Diagnostic Engine]
        INPUT[EPUB / PDF Publication] --> DIAG[Diagnostic Runner]
        DIAG --> RULES[Stable Rule Catalog<br/>EPUB-*, PDF-*]
        RULES --> REPORT[HealthReport<br/>Findings, Counts, Severity, Evidence]
    end

    SUBGRAPH_REPAIR[Safe Repair Engine]
        REPORT --> PLANNER[Repair Planner]
        PLANNER --> PLAN[RepairPlan<br/>Proposed Actions & Risk Assessment]
        PLAN --> PREVIEW[Repair Preview<br/>Structured Before / After Diff]
        PREVIEW --> APPROVE{Explicit User Apply?}
        APPROVE -- No --> DRYRUN[Dry Run Summary / Discard]
        APPROVE -- Yes --> TX[Transactional EPUB Rewriter]
        TX --> STAGING[Temporary Staging Archive]
        STAGING --> RECHECK[Re-Inspect Staged Publication]
        RECHECK --> NO_REGRESS{New Errors Detected?}
        NO_REGRESS -- Yes --> ROLLBACK[Reject & Clean Temp File]
        NO_REGRESS -- No --> COMMIT[Atomic Move to Destination<br/>book_repaired_timestamp.epub]
    end

    SUBGRAPH_PDFQA[PDF Quality Gate]
        PDF_INPUT[Exported PDF Bytes] --> PDF_RUNNER[PDF Quality Evaluator]
        PDF_RUNNER --> PDF_RULES[PDF Rules: Text, Geometry, Openability]
        PDF_RULES --> PDF_RESULT[QualityGateResult<br/>Pass / Warn / Fail]
    end
```

### 4.1 Diagnostic Finding Data Model

Each diagnostic finding produces a structured `QualityFinding`:

```ts
export type Severity = "info" | "warning" | "error" | "fatal";
export type Repairability = "none" | "manual" | "safe-auto" | "review-required";
export type QualityCategory =
  | "container"
  | "package"
  | "manifest"
  | "resource"
  | "navigation"
  | "reading-order"
  | "metadata"
  | "security"
  | "pdf-structure"
  | "pdf-text"
  | "pdf-geometry"
  | "pdf-image"
  | "pdf-font";

export interface QualityEvidence {
  readonly key: string;
  readonly value: string | number | boolean;
  readonly context?: string | undefined;
}

export interface QualityFinding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly category: QualityCategory;
  readonly message: string;
  readonly location?:
    | {
        readonly path?: string | undefined;
        readonly line?: number | undefined;
        readonly column?: number | undefined;
        readonly selector?: string | undefined;
      }
    | undefined;
  readonly evidence?: readonly QualityEvidence[] | undefined;
  readonly repairability: Repairability;
}
```

### 4.2 Stable Rule ID Naming Standard

Rule IDs are immutable string identifiers:

- `EPUB-CONTAINER-001` to `099`: ZIP structure, mimetype, container.xml.
- `EPUB-PACKAGE-001` to `099`: OPF syntax, version, namespaces, metadata basics.
- `EPUB-MANIFEST-001` to `099`: Manifest item uniqueness, missing targets, media types.
- `EPUB-RESOURCE-001` to `099`: Orphaned resources, zero-byte entries, remote assets.
- `EPUB-SPINE-001` to `099`: Spine itemrefs, reading order integrity, non-linear flags.
- `EPUB-NAV-001` to `099`: NCX and NavDoc navigation integrity and broken links.
- `EPUB-SECURITY-001` to `099`: Unsafe scripts, remote resources, DRM detection.
- `PDF-OPEN-001` to `099`: Header, openability, page count.
- `PDF-TEXT-001` to `099`: Text layer extraction, character integrity.
- `PDF-GEOM-001` to `099`: Page dimensions, aspect ratios, rotation.
- `PDF-IMAGE-001` to `099`: Image operator counts and presence.
- `PDF-FONT-001` to `099`: Font inspection claims and embedding boundaries.

### 4.3 Safe Repair Transaction and Provenance

1. **Non-Destructive Target**: Repaired output is written to `<basename>_repaired_<YYYYMMDD-HHmmss>.epub`. Original source files are strictly read-only.
2. **Byte Preservation Principle**: Archive entries not targeted by repair actions are streamed bit-for-bit without decompression/recompression or DOM pretty-printing.
3. **Verification Before Commitment**: Repaired files are immediately parsed by the diagnostic runner. If any new `fatal` or `error` findings arise that did not exist in the source, the repair is aborted and the temporary file is unlinked.
4. **Provenance Sidecar**: When requested, a `.reflowpress-repair.json` manifest is generated detailing the source SHA-256, output SHA-256, applied rule IDs, and timestamp.

---

## 5. Consequences

### Positive

- **Guaranteed Content Safety**: Users can safely run diagnostics and preview repairs without fear of corrupting original books.
- **Zero External Dependencies**: Pure TypeScript implementation guarantees immediate execution across Windows, macOS, and Linux without Java or external binaries.
- **Modular Monorepo Structure**: `@reflowpress/quality` and `@reflowpress/repair` remain decoupled from Electron and UI layers, allowing seamless use in CLI, desktop, and CI environments.
- **Comprehensive Quality Feedback**: Structural, textual, and visual regression tests safeguard against silent layout degradations.

### Negative / Trade-offs

- **Not an Official EPUB Validator**: ReflowPress diagnostics focus on practical reader and conversion health; it does not claim 100% formal W3C EPUBCheck specification parity.
- **Limited Auto-Repair Whitelist**: Complex issues (broken XHTML tags, missing chapters) are deliberately marked as `manual` rather than auto-repaired, requiring user intervention.
- **PDF Font Introspection Boundary**: PDF.js public APIs provide font names and types, but cannot conclusively certify 100% font embedding without low-level C++ font parser integration. This limitation is formally classified as `not-checkable` rather than asserting a false PASS.
