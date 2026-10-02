# ADR 0004: Library Persistence Architecture and Repository Abstraction

- Status: Accepted for Milestone 0.4
- Date: 2026-10-02
- Context & Precedents: Builds on [ADR 0001](0001-layered-publication-pipeline.md), [ADR 0002](0002-product-reboot-workbench.md), and [ADR 0003](0003-desktop-reader-runtime.md).

## Context

Milestone 0.4 expands ReflowPress from a single-file document viewer into a personal electronic publication library. The system must index, catalog, organize, filter, and shelf local EPUB and PDF collections across the user's filesystem.

A critical design challenge is selecting a persistence engine for the catalog that guarantees:

1. **Local-first durability and safety**: Zero data loss or silent catalog corruption during abrupt app shutdown or power loss.
2. **Zero native addon ABI friction**: Seamless builds and tests across developer machines and Linux CI runners without fragile native C/C++ compilation steps (e.g., node-gyp, python, MSVC).
3. **Fast responsive browsing**: Sub-10ms filtering and sorting across personal libraries (typically hundreds to several thousands of volumes).
4. **Clean architectural boundaries**: The domain logic and catalog schema must remain completely decoupled from the physical storage mechanism, allowing seamless future engine evolution.

## Options Considered

### 1. Native Relational Database (SQLite via `better-sqlite3` or `sqlite3`)

- **Strengths**:
  - Full ACID compliance with transactional rollback.
  - High-performance relational queries, indexing, and scalable pagination up to hundreds of thousands of books.
- **Weaknesses**:
  - **Native C++ Compilation & ABI Mismatch**: SQLite drivers require compiled C/C++ native addons. Electron uses distinct Node Application Binary Interface (`NODE_MODULE_VERSION`) versions that frequently conflict with host Node runtimes, requiring `electron-rebuild` or prebuild downloads.
  - **Cross-Platform CI Fragility**: Introduces toolchain dependencies (`node-gyp`, Python, C++ compilers) on GitHub Actions Windows, macOS, and Linux runners, significantly increasing build failures and maintenance overhead.
  - **Overhead for Target Scale**: Personal ebook libraries typically contain hundreds to a few thousand volumes, where relational disk indexing introduces disproportionate build and runtime complexity.

### 2. Versioned Atomic JSON Catalog + Repository Abstraction

- **Strengths**:
  - **100% Pure TypeScript & Zero Native Addons**: Installs and runs instantly on any platform and CI environment without native compilation or ABI mismatch risks.
  - **Durability via Atomic Writes**: Writes updates to a temporary sibling file (`.library-v1.json.tmp-<timestamp>`), executes `fsync` to flush disk buffers, and completes an atomic filesystem rename (`fs.rename`), preventing partial writes.
  - **Corrupt Quarantine & Self-Healing**: If invalid data or disk faults prevent parsing, the corrupted file is automatically quarantined to `.corrupt-<timestamp>` and a clean catalog is initialized with an explanatory warning.
  - **Human-Readable & Transparent**: Users can inspect, backup, or version-control their catalog using standard JSON tools, aligning with ReflowPress's open local-first philosophy.
  - **Instant Filtering & Sorting**: With the catalog loaded in memory, multi-criteria filtering (title, author, publisher, tags, collection) and sorting execute in <2ms for collections up to 10,000 items.
- **Weaknesses**:
  - Entire catalog metadata is loaded into memory at startup. Not optimized for multi-hundred-thousand item datasets without pagination.

### 3. Embedded Key-Value Store (NeDB / LevelDB / PouchDB)

- **Strengths**:
  - Document-oriented API with basic indexing.
- **Weaknesses**:
  - NeDB is unmaintained. LevelDB requires native C++ compilation. PouchDB introduces unnecessary CouchDB replication abstractions.

## Evaluation Matrix

| Criterion                                | SQLite (`better-sqlite3`)         | Versioned Atomic JSON    | Embedded KV (LevelDB) |
| ---------------------------------------- | --------------------------------- | ------------------------ | --------------------- |
| **CI & Platform Portability (No gyp)**   | Poor (Requires C++ / ABI rebuild) | **Excellent (Pure TS)**  | Poor (Native addon)   |
| **Write Durability & Atomic Commit**     | **Excellent (WAL transaction)**   | **High (sync + rename)** | High                  |
| **Crash & Corruption Recovery**          | High (WAL journal)                | **High (Quarantine)**    | Moderate              |
| **Personal Library Query Speed (<5000)** | Fast (~5ms)                       | **Instant (<2ms)**       | Fast (~5ms)           |
| **Future Schema Evolution / Extensible** | Moderate (SQL Migrations)         | **High (JSON version)**  | Moderate              |
| **User Transparency / Inspectability**   | Moderate (Requires SQLite tools)  | **High (Standard JSON)** | Low (Binary store)    |
| **Massive Scale (>100,000 books)**       | **Excellent**                     | Limited (Memory bound)   | Good                  |

## Decision

We adopt **Versioned Atomic JSON (`library-v1.json`)** coupled with a strict **`LibraryRepository` abstraction**.

```mermaid
flowchart TD
    UI[Library UI / Renderer<br/>React + Tailwind<br/>Grid, List, Search, Shelves]
    BRIDGE[Desktop Bridge / IPC<br/>window.electronAPI.library]
    DISPATCHER[Main Process IPC Dispatcher<br/>apps/desktop/src/main/ipc.ts]

    subgraph DOMAIN[packages/library — Pure TypeScript Domain]
        MODELS[Domain Models<br/>LibraryBook, LibraryCatalog, Collection, Tag]
        OPS[Pure Operations<br/>filterBooks, sortBooks, collectionManager]
        REPO_IF[LibraryRepository Interface<br/>load(), save()]
    end

    subgraph STORAGE[apps/desktop/src/main — Persistence & Scanning]
        JSON_REPO[JsonLibraryRepository<br/>Atomic write: tmp + sync + rename<br/>Corrupt quarantine]
        SCANNER[LibraryScanner<br/>Recursive walk, mtime check, SHA-256 ID]
        CACHE[Cover Thumbnail Cache<br/>userData/library-cache/covers/]
    end

    UI --> BRIDGE --> DISPATCHER
    DISPATCHER --> DOMAIN
    DISPATCHER --> STORAGE
    STORAGE --> REPO_IF
    JSON_REPO -. implements .-> REPO_IF
```

### Key Architectural Rules

1. **Repository Abstraction**: All persistence interactions occur through the `LibraryRepository` interface. If future scale requires a relational engine, SQLite can be introduced behind this interface without modifying the UI or domain logic.
2. **Atomic Write Protocol**:
   - Write serialized JSON to `library-v1.json.tmp-<timestamp>`
   - Call `fs.fsync` to flush disk buffers
   - Rename atomically over `library-v1.json`
3. **Quarantine On Corruption**: If reading fails JSON validation, rename the bad file to `library-v1.json.corrupt-<timestamp>` and create a new catalog with `schemaVersion: 1`.
4. **Stable Book Identity**: Book IDs are generated as the SHA-256 hash of the canonical absolute file path.
5. **Incremental Scanning**: Scanned files record `size` and `mtimeMs`. Subsequent scans skip re-parsing files whose size and modification timestamp have not changed.
6. **Isolated Thumbnail Storage**: Extracted covers and PDF thumbnails are stored on disk in `userData/library-cache/covers/<bookId>.png` rather than inlining large Base64 blobs in the JSON catalog.

## Consequences

### Positive

- Zero native addon build failures in CI or cross-platform setups.
- Guaranteed atomic persistence with corrupt file quarantine.
- Lightning-fast in-memory filtering and sorting.
- Clean separation between pure domain logic (`@reflowpress/library`) and disk I/O (`apps/desktop`).

### Negative / Trade-offs

- Catalogs exceeding ~50,000 books will require moving to SQLite or IndexedDB virtualization in a future milestone.
