# Architecture v2: Electronic Publication Workbench

This document describes the system architecture for ReflowPress as a free, local-first electronic document workbench.

ReflowPress builds upon the foundational contracts established in Phase 1, expanding them to power both active document reading and high-fidelity document transformation without duplicating publication parsers.

---

## Architecture v2 Overview

```mermaid
flowchart TD
    SOURCE[EPUB / PDF File]

    subgraph INSP_SUB[Inspection & Health Pipeline]
        INSPECTOR[Inspector<br/>implemented for EPUB]
        HEALTH[Health Report<br/>implemented for EPUB]
    end

    subgraph CORE_SUB[Publication Core]
        LOADER[EpubLoader<br/>implemented]
        PUB_MODEL[Publication Model<br/>implemented]
        NORMALIZED[NormalizedPublication<br/>implemented]
    end

    subgraph CONSUMER_SUB[Application Features & Engines]
        READER[Reader Engine<br/>implemented in 0.3]
        ANNOTATION[Annotation Store<br/>planned]
        LIBRARY[Library Catalog<br/>implemented in 0.4]
        SEARCH[Search Index<br/>planned]
        EXPORT[Export Engine<br/>PDF / HTML / Markdown<br/>planned]
        VALIDATION[Validation Gate<br/>PDF Quality Gate<br/>planned]
    end

    SOURCE --> INSPECTOR --> HEALTH
    SOURCE --> LOADER --> PUB_MODEL --> NORMALIZED

    NORMALIZED --> READER
    READER --> ANNOTATION
    ANNOTATION --> LIBRARY
    NORMALIZED --> SEARCH
    NORMALIZED --> EXPORT
    EXPORT --> VALIDATION
```

### Component Responsibilities

1. **Inspector**: Performs fast, safe structural checks directly on the container archive without extracting full content. Produces the `Health Report`.
2. **Health Report**: Diagnostic details on container validity, package integrity, broken references, missing assets, and typography caveats.
3. **Loader (`EpubLoader`)**: Securely reads archive contents, decrypts standard non-DRM resources (e.g. font deobfuscation if applicable), and extracts publication assets into memory/streams.
4. **NormalizedPublication**: The format-neutral, canonical representation of a book, including its reading order, navigation hierarchy, metadata, and asset map.
5. **Reader**: Coordinates layout, visual paging, typography settings, and user interaction for reflowable and fixed-layout media.
6. **Annotation & Library**: Manages user-generated reading markers (bookmarks, highlights, notes) and collection catalogs stored in local-first storage.
7. **Search Index**: Constructs indexed or runtime full-text search across chapters, publications, and annotations.
8. **Export Engine**: Converts the normalized publication into PDF (via CSS Paged Media rendering), clean HTML, or Markdown.
9. **Validation Gate**: Asserts that generated outputs meet strict quality requirements before being marked as successful.

---

## Publication Core

A foundational principle of Architecture v2 is:

> **The Reader and the Exporter share one Publication Core.**
> An EPUB reader and a PDF export engine must not implement separate, diverging EPUB parsers.

### The Unified Publication Pipeline

```mermaid
flowchart LR
    ARCHIVE[EPUB Archive] --> EPUBLOADER[EpubLoader]
    EPUBLOADER --> RESOURCES[Publication Resources]
    RESOURCES --> SPINE[Reading Order & Spine]
    RESOURCES --> NAV[Navigation: NCX & Nav Doc]
    SPINE --> NORMALIZER[Publication Normalizer]
    NAV --> NORMALIZER
    NORMALIZER --> NORMALIZED[NormalizedPublication]

    NORMALIZED --> READER[Reader Engine]
    NORMALIZED --> EXPORT[PDF / HTML / MD Exporter]
```

### Milestone 0.2 Implementation: Enhanced `NormalizedPublication` Contract

In Milestone 0.2, the publication model was enhanced in `@reflowpress/core` without breaking backward compatibility:

```ts
export interface NavigationItem {
  readonly id?: string;
  readonly label: string;
  readonly href: string;
  readonly children?: readonly NavigationItem[];
}

export interface PublicationMetadata {
  readonly title?: string;
  readonly language?: string;
  readonly identifier?: string;
  readonly creator?: string | readonly string[];
  readonly publisher?: string;
  readonly description?: string;
  readonly rights?: string;
  readonly modified?: string;
  readonly renditionLayout?: "reflowable" | "pre-paginated";
  readonly renditionOrientation?: "auto" | "portrait" | "landscape";
  readonly renditionSpread?: "auto" | "none" | "landscape" | "both";
  readonly direction?: "ltr" | "rtl" | "default";
}

export interface PublicationSection {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly markup: string;
  readonly linear?: boolean;
}

export interface NormalizedPublication {
  readonly version?: "2.0" | "3.0" | string;
  readonly metadata: PublicationMetadata;
  readonly readingOrder: readonly PublicationSection[];
  readonly resources: readonly PublicationResource[];
  readonly navigation?: readonly NavigationItem[];
}
```

### Shared Parsing Primitives (One Parser Path)

`packages/epub` avoids duplicating archive reading and XML/OPF parsing across `inspectEpub` and `EpubLoader`. The shared primitives are:

- `archive.ts`: Streaming ZIP archive access via `yauzl`, CRC32 validation, entry name safety checks, and strict byte limits.
- `xml.ts`: Non-DTD XML document parsing with `@xmldom/xmldom` and direct element traversal helpers.
- `path.ts`: Pure archive-relative path resolution with directory traversal prevention.
- `package-document.ts`: Unified OPF parsing for EPUB 2/3 metadata, manifest item resolution, spine reading order, and navigation document references.
- `navigation.ts`: Unified normalization of EPUB 3 Navigation Document (`<nav epub:type="toc">`) and EPUB 2 NCX (`<navMap> <navPoint>`).

---

## Package Architecture Proposal

### Current Package Structure (Phase 1 Baseline)

```text
packages/
  core/        - Shared format-neutral contracts
  epub/        - EPUB Inspector (implemented), adapter contracts (planned)
  pdf/         - PDF output contract types
  renderer/    - Renderer interface contracts
  validation/  - PDF validator interface contracts
apps/
  cli/         - Command-line entry point (placeholder)
```

### Future Package Architecture Proposal

As ReflowPress grows toward Milestone 1.0, responsibilities will be partitioned into focused, single-purpose packages to avoid turning `core` into an unwieldy monolith:

```mermaid
flowchart TD
    subgraph APPS[Applications]
        CLI[apps/cli]
        DESKTOP[apps/desktop]
    end

    subgraph CORE_LAYER[Domain Core & Publication]
        CORE[packages/core<br/>Prims & base contracts]
        PUB[packages/publication<br/>Normalized models & loader contracts]
    end

    subgraph ADAPTERS[Format Adapters]
        EPUB[packages/epub<br/>EPUB Inspector & Loader]
        PDF[packages/pdf<br/>PDF Loader & Generator]
    end

    subgraph ENGINES[Engines & Workbench Modules]
        RENDERER[packages/renderer<br/>Layout & Render Engine]
        VALIDATION[packages/validation<br/>Quality Gate Rules]
        LIBRARY[packages/library<br/>Local Catalog & Collections]
        SEARCH[packages/search<br/>Multi-scope Search Engine]
        ANNOTATIONS[packages/annotations<br/>Highlight & Note Models]
        STORAGE[packages/storage<br/>Local-first persistence]
    end

    APPS --> CORE_LAYER
    APPS --> ENGINES
    ENGINES --> CORE_LAYER
    ADAPTERS --> CORE_LAYER
    EPUB --> PUB
    PDF --> PUB
```

### Proposed Package Responsibilities

- `@reflowpress/core`: Primitive types, error classification, common utilities, and system abstractions. Kept ultra-light.
- `@reflowpress/publication`: Definition of `NormalizedPublication`, section hierarchies, resource trees, and loader abstractions.
- `@reflowpress/epub`: EPUB Inspector, EPUB 2/3 Loader, resource unpacker, and safe repair mechanics.
- `@reflowpress/pdf`: PDF document abstraction, PDF rendering target, and PDF parser.
- `@reflowpress/renderer`: Presentation engine abstractions, CSS layout processing, pagination math.
- `@reflowpress/validation`: Rules engine for EPUB diagnostic checks and PDF Quality Gate assertions.
- `@reflowpress/library`: SQLite/file-based book indexing, cover generation, collections, and shelf queries.
- `@reflowpress/search`: Inverted index and streaming search across publications and notes.
- `@reflowpress/annotations`: Highlight anchoring (EPUB CFI / text selectors), notes, bookmark models, and export serializers.
- `@reflowpress/storage`: Local filesystem abstraction, atomic file writing, backup rotation, and platform-specific path helpers.

_Note: These packages represent an architectural roadmap. They will be introduced incrementally according to the milestone schedule rather than created prematurely._

---

## Desktop Architecture (Milestone 0.3)

In Milestone 0.3, ReflowPress implemented its desktop reader runtime as defined in [ADR 0003: Desktop Reader Runtime](adr/0003-desktop-reader-runtime.md). The desktop application maintains strict architectural boundaries across three layers:

```mermaid
flowchart TD
    subgraph SHELL[Desktop Shell: apps/desktop]
        MAIN[Electron Main Process<br/>Window lifecycle, safe IPC, atomic storage]
        PRELOAD[Preload Script<br/>contextIsolation, allowlisted bridge]
        RENDERER[React 19 + Vite Renderer<br/>Header, TOC Drawer, Footer, Settings]
    end

    subgraph ADAPTER[Application Adapter]
        BRIDGE[Desktop Bridge: reflowPressDesktop]
        SANITIZER[XHTML Sanitizer & Blob Resource Manager]
    end

    subgraph WORKBENCH[Pure Shared Domain Packages]
        READER_PKG[@reflowpress/reader<br/>State, Navigation, Settings, Location]
        CORE_PKG[@reflowpress/core<br/>NormalizedPublication, Section, Resource]
        EPUB_PKG[@reflowpress/epub<br/>loadEpub, inspectEpub]
    end

    MAIN --> PRELOAD
    PRELOAD --> BRIDGE
    BRIDGE --> RENDERER
    RENDERER --> SANITIZER
    RENDERER --> READER_PKG
    MAIN --> EPUB_PKG
    MAIN --> CORE_PKG
```

### Key Architectural Characteristics

1. **Security & Sandbox Isolation**:
   - `contextIsolation = true`, `nodeIntegration = false`, and `sandbox = true`.
   - The React renderer process has zero access to Node `fs`, `child_process`, or internal system handles.
   - All IPC communication is strictly typed and allowlisted via `contextBridge.exposeInMainWorld("reflowPressDesktop", ...)`.
   - Unauthorized external navigation and popup window creation are unconditionally blocked.

2. **UI-Independent Reader Domain (`@reflowpress/reader`)**:
   - Encapsulates pure domain logic: reading positions, navigation clamping, section href lookups, reader settings, and status state machines.
   - 100% free of Electron or React dependencies, ensuring complete portability for future CLI, web, or mobile runtimes.

3. **Multi-Format Publication Viewing**:
   - **Reflowable EPUB**: Rendered inside a sandboxed `<iframe>` (`sandbox="allow-same-origin"`, script execution blocked). XHTML is pre-sanitized by removing dangerous tags (`<script>`, `<object>`, `<embed>`), stripping inline event handlers (`onclick`, etc.), and neutralizing `javascript:` URLs. Publication assets (CSS, images, fonts) are served via mapped Blob URLs with disposal upon book unload.
   - **Native PDF**: Rendered directly onto an HTML5 `<canvas>` using Mozilla `pdfjs-dist` with page navigation and zoom controls (50% to 300%). The reader UI theme surrounds the canvas without inverting PDF page pixels.

4. **Atomic Reading Position Persistence**:
   - `ReadingPositionStore` persists active reading positions (section href, progress percentage, PDF page, zoom) to a localized JSON file (`reader-state.json`).
   - Uses write-to-temp-file and atomic rename semantics to prevent corruption during unexpected shutdowns. Restores position automatically upon reopening.

---

## Library Subsystem & Catalog Persistence (Milestone 0.4)

Milestone 0.4 integrates a local-first publication catalog into the desktop workbench, enabling multi-book management, fast search, custom collections, and cover extraction.

```mermaid
flowchart TD
    UI[Library Workbench UI<br/>Grid, List, Search, Shelves]
    BRIDGE[Desktop IPC Bridge<br/>reflowPressDesktop.library]
    IPC[Main Process Dispatcher<br/>apps/desktop/src/main/ipc.ts]

    subgraph DOMAIN[packages/library — Pure Domain Logic]
        MODELS[Models: LibraryBook, LibraryCatalog, Collection, Tag]
        OPERATIONS[Pure Operations: filterBooks, sortBooks, manageCollections]
        REPO_IF[LibraryRepository Interface]
    end

    subgraph MAIN_PERSIST[apps/desktop/src/main — Persistence & Scanning]
        JSON_REPO[JsonLibraryRepository<br/>library-v1.json<br/>Atomic write & Corrupt Quarantine]
        SCANNER[LibraryScanner<br/>Recursive walk, mtime check, SHA-256 ID]
        COVERS[Cover Cache<br/>userData/library-cache/covers/]
    end

    UI --> BRIDGE --> IPC
    IPC --> OPERATIONS
    IPC --> JSON_REPO
    IPC --> SCANNER
    JSON_REPO -. implements .-> REPO_IF
    SCANNER --> COVERS
```

### Architectural Key Decisions & Safeguards:

1. **Versioned Atomic JSON Persistence (`library-v1.json`)**:
   - Implemented via `JsonLibraryRepository` adhering to the `LibraryRepository` domain interface.
   - Durability guaranteed by writing to `.tmp-<timestamp>`, syncing to disk via `fsync`, and executing an atomic rename.
   - **Corrupt Quarantine**: Malformed or unreadable catalogs are automatically backed up to `.corrupt-<timestamp>` and a fresh valid catalog (`schemaVersion: 1`) is initialized with warnings.

2. **Recursive Scanner & Incremental Indexing**:
   - `LibraryScanner` walks local directory trees finding `.epub` and `.pdf` files.
   - Computes deterministic SHA-256 IDs based on normalized canonical file paths.
   - Records `fileSizeBytes` and `modifiedTimeMs`. Re-scans compare disk stats and skip re-parsing unchanged books, guaranteeing high scan performance on large directories.

3. **Safe Cover Extraction & Caching**:
   - Extracts EPUB cover images from archive resources and caches them to `userData/library-cache/covers/<id>.<ext>`.
   - Desktop bridge exposes `readCoverImage` returning base64 data URIs, preserving complete Electron renderer sandbox isolation (`sandbox: true`, `nodeIntegration: false`).

4. **Multi-Criteria Filtering & Organization**:
   - Multi-field search across title, author, publisher, and tags.
   - Format filtering (`all`, `epub`, `pdf`), custom user shelves/collections, and sorting (recently added, title, author, last opened).
   - Seamless bidirectional transition between Library catalog and Reader MVP.
   - Full rationale documented in [ADR 0004: Library Persistence Architecture](adr/0004-library-persistence.md).

---

## Reading Tools Subsystem & Annotation Architecture (Milestone 0.5)

Milestone 0.5 evolves ReflowPress into an active reading workbench by introducing in-book full-text search, persistent bookmarks, multi-color text highlights, margin notes, and portable export/import capabilities.

```mermaid
flowchart TD
    UI[Reader Workbench UI<br/>ReadingToolsDrawer, SelectionToolbar, Header]
    BRIDGE[Desktop IPC Bridge<br/>reflowPressDesktop.annotations]
    IPC[Main Process Dispatcher<br/>apps/desktop/src/main/ipc.ts]

    subgraph SEARCH_DOMAIN[packages/search — Pure Search Engine]
        EXTRACTOR[TextExtractor<br/>Tag stripping, entity decoding, snippet math]
        EPUB_SEARCH[EpubSearchEngine<br/>Section walk, regex/case-insensitive search]
        PDF_SEARCH[PdfSearchEngine<br/>Multi-page text layer extraction]
    end

    subgraph ANNOTATIONS_DOMAIN[packages/annotations — Pure Domain Logic]
        MODELS[Models: Highlight, Note, Bookmark, PublicationLocator]
        ANCHOR[Anchoring Engine<br/>W3C Web Annotation Selector disambiguation]
        OPERATIONS[Domain Operations: createHighlight, addNote, toggleBookmark]
        SERIALIZERS[Export/Import Serializers<br/>JSON, Markdown, Escaped HTML]
        REPO_IF[AnnotationRepository Interface]
    end

    subgraph MAIN_PERSIST[apps/desktop/src/main — Persistence & File Dialogs]
        JSON_REPO[JsonAnnotationRepository<br/>annotations-v1.json<br/>Serialized Queue, Atomic write & Corrupt Quarantine]
        DIALOGS[File Dialogs<br/>Save/Open for Export & Import]
    end

    UI --> BRIDGE --> IPC
    UI --> SEARCH_DOMAIN
    UI --> ANNOTATIONS_DOMAIN
    IPC --> JSON_REPO
    IPC --> DIALOGS
    JSON_REPO -. implements .-> REPO_IF
```

### Architectural Key Decisions & Safeguards:

1. **W3C Web Annotation Compliant Hybrid Locators (`PublicationLocator`)**:
   - Anchoring relies on a composite locator rather than fragile single-strategy offsets or brittle DOM XPaths:
     - **EPUB**: Combines `sectionHref` + `TextQuoteSelector` (`exact`, `prefix`, `suffix`) + `TextPositionSelector` (`start`, `end`).
     - **PDF**: Combines `page` (1-based index) + `TextQuoteSelector` + optional bounding rects.
   - Robust against font resizing, reader window resizing, theme changes, and minor publisher markup updates.
   - Disambiguation engine uses surrounding prefix/suffix context to match the exact intended text occurrence even when repeated words occur within the same chapter.

2. **Pure Search Engine (`@reflowpress/search`)**:
   - `TextExtractor` removes markup elements (`<script>`, `<style>`, XML comments), decodes character and numeric entities, and builds unified plain-text layers.
   - Produces localized snippet previews with exact character boundaries and surrogate-pair safety.
   - Decoupled from renderer UI and desktop IPC, enabling headless CLI or worker thread execution.

3. **Versioned Atomic Annotation Storage (`annotations-v1.json`)**:
   - `JsonAnnotationRepository` guarantees crash-safety using a serialized promise queue, write-to-temp-file (`.tmp-<timestamp>`), `fsync`, and atomic rename.
   - **Corrupt Quarantine**: Invalid or unparseable JSON files are automatically quarantined to `.corrupt-<timestamp>` with warnings, safeguarding user data from silent overwrites.
   - **Version Guard**: Prevents older software from overwriting newer future schema versions.

4. **Portable Knowledge Management (PKM) Export & Import**:
   - **Markdown**: Clean, human-readable export with publication metadata, blockquotes, notes, bookmarks, and timestamps.
   - **HTML**: Standalone, styled document with zero external dependencies and full XSS-safe attribute/text escaping.
   - **JSON**: Complete structured serialization enabling backup, tool migration, and bi-directional import with duplicate deduplication and ID-conflict remapping.
   - Source publications (EPUB/PDF) are **never** modified or mutated.
   - Full rationale documented in [ADR 0005: Annotation Locators, Selectors, and Storage Architecture](adr/0005-annotation-locators-and-storage.md).

---

## AI Policy & Integration Stance

1. **Non-Dependency**: AI is strictly optional. ReflowPress is completely usable, fast, and feature-complete in 100% offline, air-gapped environments without any AI components.
2. **Downstream Integration via Open Artifacts**: Rather than embedding complex proprietary LLM runtimes directly into the reading loop, ReflowPress empowers users to export clean, semantic artifacts (e.g. structured Markdown, sanitized text layers, JSON notes) that can be seamlessly consumed by external tools (ChatGPT, NotebookLM, local Ollama/Llama.cpp models, or personal PKM tools).
3. **User Consent & Privacy**: No document data or reading metadata will ever be transmitted to external AI endpoints without explicit, manual user initiation.

---

## Security and Privacy Design

- **Untrusted Input**: Electronic publications downloaded from the web are treated as untrusted bytecode/content.
- **Archive Traversal Prevention**: The ZIP extraction layer prohibits directory traversal (`../`) and enforces canonical relative paths within a virtual root.
- **Strict Network Isolation**: The reader and export engines reject remote HTTP/HTTPS resource loads by default to prevent IP tracking, telemetry beacons, and SSRF vulnerabilities.
- **Atomic, Non-destructive File Writes**: Document repairs, annotation saves, and export generation write to temporary files first and atomically rename upon completion. The original publication is never modified in place.
