# ADR 0009: Interoperability, Synchronization, and Device Architecture

## Status

Accepted

## Context

ReflowPress has matured into a comprehensive local-first reading and publication workbench with publication inspection, reading tools, Japanese typography, PDF/HTML/Markdown export (Milestone 0.7), and safe repair (Milestone 0.8). However, publications, reading positions, annotations, collections, and repaired files have been confined to a single device installation.

Milestone 0.9 addresses **Interoperability**: enabling users to share publications and reading data across other ReflowPress installations, standard OPDS readers, physical e-reader hardware, and personal sync storage—while strictly preserving ReflowPress's core principles:

1. **Local-first, privacy-first, offline-first**: No mandatory accounts, no telemetry, no silent cloud sync, no vendor lock-in.
2. **Untrusted inputs**: All external feeds, remote servers, sync bundles, and connected devices are treated as untrusted inputs.
3. **Non-destructive operations**: Original publication files are never modified in place, and user annotations/notes are never silently overwritten during conflict reconciliation.

## Specification References & Verification (Access Date: October 2026)

1. **OPDS 2.0 (Open Publication Distribution System 2.0)**:
   - Specification: Community Group / Readium Web Publication Manifest profile (`application/opds+json`).
   - URL: `https://specs.opds.io/opds-2.0`
   - Key aspects: JSON-LD / schema.org metadata, publication collections, opaque acquisition links (`rel: "http://opds-spec.org/acquisition"`), image thumbnails, URI templates, and pagination (`first`, `last`, `prev`, `next`).
2. **OPDS 1.2 (Atom XML Legacy Compatibility)**:
   - Specification: Atom XML syndication catalog (`application/atom+xml;profile=opds-catalog;kind=acquisition`).
   - URL: `https://specs.opds.io/opds-1.2.html`
3. **WebDAV (Web Distributed Authoring and Versioning)**:
   - Specification: IETF RFC 4918 (June 2007, obsoleting RFC 2518).
   - URL: `https://datatracker.ietf.org/doc/html/rfc4918`
   - Core methods: `PROPFIND` (with XML multistatus response), `GET`, `PUT`, `MKCOL`.
4. **EPUB 3.3 Media Overlays**:
   - Specification: W3C Recommendation 25 May 2023.
   - URL: `https://www.w3.org/TR/epub-33/#sec-media-overlays` and `https://www.w3.org/TR/epub-rs-33/#sec-media-overlays`
   - Key aspects: OPF manifest `media-overlay` attribute pointing to SMIL 3.0 documents (`application/smil+xml`), `media:duration` package metadata, `<par>`, `<text src="...">`, `<audio src="..." clipBegin="..." clipEnd="...">`.

## Decisions

### 1. Architectural Partitioning

Interoperability features are partitioned into focused domain packages rather than monolithic modules:

- `@reflowpress/opds` (`packages/opds`): Pure OPDS 2.0 feed generator, OPDS 1.2 parser fallback, pagination models, acquisition link builders, and read-only HTTP handler. Free of Electron and direct filesystem access.
- `@reflowpress/sync` (`packages/sync`): Portable publication identity, sync manifest/snapshot models, 3-way merge engine, conflict detector, tombstones, backup/restore planners, FolderSyncAdapter, and WebDAVSyncAdapter.
- `@reflowpress/device` (`packages/device`): `DeviceAdapter` abstraction, `FilesystemDeviceAdapter` (USB Mass Storage / mounted folder), device profile recognition, transfer planning, collision resolution, free space preflight, and SHA-256 integrity verification.
- Media Overlays: Parsed and modeled within `@reflowpress/epub` to preserve unified publication parsing without adding unnecessary standalone packages.

### 2. Portable Publication Identity vs. Local Book ID

In local workbench operations, books are identified by `LocalBookId` (derived from canonical local filesystem paths). Across different machines (e.g. Windows `C:\Books\novel.epub` vs. macOS `/Users/alice/Books/novel.epub`), filesystem paths inevitably differ.

- ReflowPress defines `PortablePublicationId`: computed deterministically from publication metadata identifier (`dc:identifier`), or SHA-256 hash of publication content, ensuring that books across disparate machines reconcile accurately during synchronization.

### 3. OPDS Strategy: OPDS 2.0 Primary with Read Compatibility

- **Primary Standard**: ReflowPress adopts OPDS 2.0 (`application/opds+json`) for local feed generation and remote client browsing.
- **OPDS 1.2 Compatibility**: For remote catalogs using Atom XML (e.g., Calibre / older feeds), the client includes an Atom XML parser fallback to ensure wide reader compatibility.

### 4. Local Read-Only OPDS Server Security

- **Default State**: Server is OFF by default. It only runs when explicitly started by the user in the UI or CLI.
- **Network Interface**: Default bind is loopback only (`127.0.0.1` / `::1`). LAN exposure (`0.0.0.0`) requires an explicit CLI flag (`--allow-lan`) or Desktop toggle with a security warning.
- **Read-Only Scope**: The server allows only `GET` and `HEAD`. Any mutation, file deletion, annotation edit, or upload endpoint is strictly forbidden.
- **No Local Path Leakage**: Feed URLs use opaque IDs (`/opds/v2/publications/:id/acquisition`, `/opds/v2/publications/:id/cover`). Host filesystem paths (`C:\Users\...`) are never exposed in feed JSON/XML.
- **HTTP Range Requests**: Supported for publication acquisitions with `206 Partial Content` and `Content-Range`, enabling e-readers to stream large EPUB/PDF files.

### 5. Remote OPDS Client Security

- **Strict Protocol Allowlist**: Only `http:` and `https:` schemes are permitted (`file:`, `ftp:`, `data:`, `javascript:` are rejected).
- **Resource Constraints**: Strict request timeout (default 15s) and maximum response size limits (10 MiB for feeds, 250 MiB for publications).
- **Redirect Hygiene**: Cross-origin redirects automatically strip the `Authorization` header to prevent credential theft.
- **Download Quality Gate**: Downloaded publications pass through temporary staging, size verification, and `inspectEpubHealth()`, presenting diagnostics to the user before addition to the local library.

### 6. Portable Sync Bundle & Folder-Based Sync

- ReflowPress avoids provider-specific cloud SDK lock-in (e.g. proprietary Dropbox/Google Drive APIs). Instead, it implements a **Portable Sync Bundle** architecture compatible with any file-syncing utility (Syncthing, Dropbox Desktop folder, Nextcloud, iCloud Drive, or USB drive).
- **Bundle Layout**:
  ```text
  ReflowPressSync/
    manifest.json      # schemaVersion: 1, installationId, timestamp, counts
    library.json       # Collections, tags, book metadata
    annotations.json   # Bookmarks, highlights, notes
    reader-state.json  # Reading positions
    tombstones.json    # Deletion records
    conflicts.json     # Unresolved merge conflicts
    books/             # Optional publication binaries (default: OFF to save bandwidth)
  ```
- **Concurrency & Locking**: Multi-process folder access is guarded by `.sync.lock` leases with timestamped stale-lock expiration (60 seconds) and atomic temp-to-rename writes.

### 7. Three-Way Merge & Conflict Preservation

- To prevent silent data loss, the synchronization engine implements 3-way merge logic against a common `baseSnapshot`:
  - `base == local && remote changed` -> Apply remote change.
  - `base == remote && local changed` -> Apply local change.
  - `local == remote` -> Clean, no-op.
  - `local != base && remote != base && local != remote` -> **Conflict**.
- **Zero Silent Data Loss**: Conflicting records are never discarded or arbitrarily overwritten by "Last-Write-Wins". They are cataloged into `ConflictRecord` containing `base`, `local`, and `remote` representations.
- **Resolution Options**: Desktop UI and CLI expose explicit choices: `Keep Local`, `Keep Remote`, or `Keep Both` (applicable to annotations and collections).
- **Tombstones**: Deletions are tracked via `TombstoneRecord` with deletion timestamp and revision hash, preventing deleted books/annotations from re-appearing upon sync.

### 8. WebDAV Sync Adapter

- RFC 4918 WebDAV is implemented as a remote sync transport using `PROPFIND`, `GET`, `PUT`, and `MKCOL`.
- **HTTPS Enforcement**: HTTPS is required by default; unencrypted HTTP is restricted to `localhost` or explicit insecure opt-in.
- **Credential Safety**: CLI reads credentials from environment variables (`REFLOWPRESS_WEBDAV_USERNAME`, `REFLOWPRESS_WEBDAV_PASSWORD`) or stdin. Passwords in plaintext CLI flags (`--password`) are forbidden. Desktop uses OS-backed encrypted credential storage where available.

### 9. E-Reader Device Transfer & Safety

- Device interaction is abstracted behind `DeviceAdapter`.
- **FilesystemDeviceAdapter**: Supports USB Mass Storage and mounted folders.
- **Manual Folder Target**: Provides manual directory selection as a universal cross-platform fallback.
- **Containment Boundary**: Strict relative path normalization ensures files cannot escape the designated device root directory.
- **Integrity Verification**: Transferred publications are written to temporary staging files on device, checked for SHA-256 match against source file, and atomically committed.
- **Free Space Preflight**: Checks available bytes before copy begins to prevent corrupt half-written files.
- **No Device Deletion**: ReflowPress never deletes or mirrors-delete files on connected e-reader devices by default.

### 10. MTP (Media Transfer Protocol) Technical Spike & Boundary

- **Evaluation**: We investigated MTP bindings in Node.js (Windows Portable Devices COM APIs, `libmtp` C wrappers, `node-mtp`).
- **Findings**: Native MTP libraries lack reliable, precompiled cross-platform binaries for modern Node.js versions (Node 20/22) on Windows/macOS/Linux ARM64, introduce complex driver conflicts (WinUSB replacement on Windows), and carry restrictive GPL licenses.
- **Decision**: In adherence to User Rule #80 ("Do NOT build MTP wire protocol from scratch") and Rule #81 ("MTP implementation gate: only implement if stable/distributable"), ReflowPress defines the `MtpDeviceAdapter` interface and marks its status as **Unavailable / Deferred**. We do not advertise fake MTP support; users are guided to use standard USB Mass Storage mode or mounted directories.

### 11. EPUB 3.3 Media Overlays Support Boundary

- ReflowPress implements full **Media Overlay Detection, SMIL 3.0 Parsing, Metadata Extraction, and Validation**:
  - Detects `media-overlay` attributes on OPF manifest items.
  - Safely parses associated SMIL documents without script execution.
  - Extracts audio references, clip timings (`clipBegin`, `clipEnd`), text target anchors, and total chapter/book durations.
  - Flags missing audio files or broken text fragment IDs in health reports.
- **Playback Boundary**: Synchronized audio narration playback is acknowledged as planned for future post-1.0 accessibility releases. In Milestone 0.9, detection, extraction, and reportage are complete.

## Consequences

- ReflowPress publications and annotations can be synchronized across devices without cloud vendor lock-in.
- Users can browse their ReflowPress library from mobile e-readers (KOReader, Moon+ Reader) via OPDS.
- Conflict detection guarantees user annotations and reading states are never silently lost.
- E-reader transfers over USB are safe, verified by SHA-256, and protected against disk overflow.
- Clean boundaries for MTP and Media Overlay playback prevent deceptive claims while providing production-quality foundations.
