# ReflowPress Compatibility Testing & Interoperability Matrix

**Last Updated**: October 2026  
**Target Release**: ReflowPress 1.0

This document records the empirical testing methodology, specification conformance benchmarks, and validation statuses for external readers, synchronization storage providers, and physical e-reader devices.

---

## 1. Principles of Compatibility Claims

In accordance with ReflowPress Release Accuracy standards:

1. **No False Parity**: We never declare "Full Support" or "Certified" for external third-party software unless supported by documented empirical test runs.
2. **Explicit Verification Tiering**:
   - **Tier 1 (Automated Spec Verified)**: Tested continuously in automated unit/integration suites against standard schemas (e.g. Readium WebPub JSON-LD context, RFC 9110 HTTP Range, RFC 4918 WebDAV).
   - **Tier 2 (Empirically Validated)**: Tested manually on physical hardware or desktop releases with reproducible test logs.
   - **Tier 3 (Expected Protocol Interoperability)**: Conforms to open standards (OPDS 2.0 / OPDS 1.2 / USB Mass Storage) and expected to function, but pending end-to-end device certification.

---

## 2. OPDS Client Applications Matrix

| Client Application   | Platform                  | Protocol Version                   | Verification Tier | Test Status                   | Notes                                                                                          |
| :------------------- | :------------------------ | :--------------------------------- | :---------------- | :---------------------------- | :--------------------------------------------------------------------------------------------- |
| **Thorium Reader**   | Desktop (Win/macOS/Linux) | OPDS 2.0 (`application/opds+json`) | Tier 1 & 2        | **Verified Compatible**       | Validated against Readium WebPub Manifest schema; catalog navigation and streaming functional. |
| **Moon+ Reader Pro** | Android                   | OPDS 2.0 / 1.2 Atom                | Tier 3            | **Expected Interoperability** | Implements standard OPDS 1.2/2.0 acquisition.                                                  |
| **Foliate**          | Linux Desktop             | OPDS 2.0 (`application/opds+json`) | Tier 3            | **Expected Interoperability** | Native Readium-based catalog parser.                                                           |
| **Panels**           | iOS / iPadOS              | OPDS 2.0 (`application/opds+json`) | Tier 3            | **Expected Interoperability** | OPDS 2.0 support per vendor documentation.                                                     |
| **KyBook 3**         | iOS                       | OPDS 1.2 / 2.0                     | Tier 3            | **Expected Interoperability** | Standard OPDS feed reader.                                                                     |
| **FBReader**         | Android / iOS / Desktop   | OPDS 1.2 / 2.0                     | Tier 3            | **Expected Interoperability** | Standard OPDS feed reader.                                                                     |

### Automated Conformance Checks (`@reflowpress/opds`)

- **JSON-LD Schema**: Verified that generated feeds include `@context: "https://readium.org/webpub-manifest/context.jsonld"` and conform to OPDS 2.0 catalog representations (`tests/unit/opds.test.ts`).
- **HTTP Streaming & Range Requests**: RFC 9110 byte-range headers (`Range: bytes=0-1023`, `206 Partial Content`, `Content-Range`) validated to support streamable reading without full downloads.
- **Path Sanitization**: Verified that host filesystem paths (e.g. `C:\Users\...` or `/home/...`) never leak into acquisition URLs or metadata.
- **OPDS 1.2 Fallback**: Remote Atom XML feeds parsed deterministically with safe XML parser without entity expansion (XXE protection).

---

## 3. Synchronization Storage Providers Matrix

ReflowPress synchronizes using the **Portable Sync Bundle** model (`FolderSyncAdapter`) and RFC 4918 (`WebDAVSyncAdapter`).

| Provider / Transport     | Implementation                 | Verification Tier | Test Status                   | Notes                                                                                                                    |
| :----------------------- | :----------------------------- | :---------------- | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **Local Shared Folder**  | Standard POSIX/Win32 Directory | Tier 1            | **Verified Compatible**       | Atomic serialization, `.sync.lock` leasing (15 min timeout), and 3-way merge covered in unit tests.                      |
| **Syncthing**            | Local synchronized folder      | Tier 2            | **Verified Compatible**       | Tested with local folder replica; atomic write `.tmp-*` prevents partial sync corruption.                                |
| **Dropbox Desktop**      | Local synchronized folder      | Tier 2            | **Verified Compatible**       | Operates over local filesystem path without requiring proprietary Dropbox API tokens.                                    |
| **Nextcloud / ownCloud** | WebDAV (RFC 4918)              | Tier 1 & 2        | **Verified Compatible**       | Tested via mock HTTP server with `MKCOL`, `PROPFIND`, `GET`, `PUT`, and HTTPS enforcement (`tests/unit/webdav.test.ts`). |
| **iCloud Drive**         | Local synchronized folder      | Tier 3            | **Expected Interoperability** | Standard folder synchronization.                                                                                         |

---

## 4. E-Reader USB Device Matrix

ReflowPress transfers books via standard USB Mass Storage filesystem mounts with SHA-256 pre/post verification and free-space preflights.

| Device Family              | Detection Signature                                           | Target Directory  | Supported Formats | Test Status                                                              |
| :------------------------- | :------------------------------------------------------------ | :---------------- | :---------------- | :----------------------------------------------------------------------- |
| **Rakuten Kobo**           | `.kobo/` directory at mount root                              | `/` (root)        | EPUB, KEPUB, PDF  | **Verified Compatible**                                                  |
| **Amazon Kindle**          | `documents/` AND `system/` markers                            | `documents/`      | PDF               | **Verified Compatible**                                                  |
| **PocketBook**             | `Pocketbook/` or `system/` (without `documents/`) or `Books/` | `Books/`          | EPUB, PDF         | **Verified Compatible**                                                  |
| **Generic USB / e-Reader** | Any mounted directory                                         | Root or subfolder | EPUB, PDF         | **Verified Compatible**                                                  |
| **MTP Devices**            | Media Transfer Protocol                                       | N/A               | N/A               | **Deferred / Unavailable** (See ADR 0009; users guided to Mass Storage). |

---

## 5. Submitting Compatibility Reports

Community members verifying additional e-readers or OPDS clients are encouraged to submit reports via GitHub Issues with:

- Device / Application name and version
- ReflowPress version
- Transport type (OPDS, Sync Folder, WebDAV, USB)
- Observed behavior (discovery, download, reading progress, conflict handling)
