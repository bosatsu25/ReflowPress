# Security Policy

## Supported Versions

Only the latest stable release line receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## Reporting a Vulnerability

We take the security of ReflowPress seriously. If you believe you have discovered a security vulnerability, please report it responsibly:

1. **Do NOT report security vulnerabilities via public GitHub issues, discussions, or pull requests.**
2. Send an email to the project maintainers or file a confidential advisory through GitHub's [Security Advisory tab](https://github.com/bosatsu25/ReflowPress/security/advisories/new).
3. Include the following details:
   - Impacted version(s)
   - Step-by-step reproduction steps or a minimal proof-of-concept file
   - Analysis of potential impact

We will acknowledge receipt within 48 hours and work with you to triage and address the issue before any public disclosure.

---

## Security Architecture & Defense in Depth

ReflowPress enforces multi-layered defenses across the desktop and CLI applications:

The design and the reasons behind it are recorded in [ADR 0011](docs/adr/0011-desktop-trust-boundary.md).

### 1. Process Isolation & Renderer Sandboxing

- **Context Isolation**: Always enabled (`contextIsolation: true`).
- **No Node Integration**: Renderers never have access to Node.js APIs (`nodeIntegration: false`).
- **Sandbox**: Enabled (`sandbox: true`); `<webview>` is disabled and the spellchecker (which downloads dictionaries) is off.
- **Custom Protocol**: The renderer is served from `app://reflowpress/`, not `file://`. The protocol handler only serves the renderer build directory, and the `grantFileProtocolExtraPrivileges` fuse is off.
- **Session Lockdown**: All permission requests are denied, network requests outside the app's own origin are blocked, and navigation, redirects and new windows are refused.

### 2. Strict Content Security Policy (CSP)

The same policy is sent as a response header and as a `<meta>` tag (a unit test keeps them identical):

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data: blob:;
frame-src 'self' blob:;
worker-src 'self' blob:;
connect-src 'self' blob:;
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

- Remote script execution and remote connections from the renderer are blocked.
- pdf.js runs with `isEvalSupported: false`.

### 3. XML & Publication Security

- **XXE and DTD Defense**: The publication loader (`@reflowpress/epub`) uses strict XML parsing without external entity resolution or parameter entity expansion.
- **Zip-Slip & Traversal Prevention**: File extraction verifies that normalized archive entries remain strictly contained within their designated target root.
- **Archive Limits**: Archive size, entry count, and per-entry and total decompressed size are checked before anything is decompressed, and actual sizes and CRCs are verified, on every archive read path — loading, quality checks and repair.
- **Sanitized XHTML**: Reader content is scrubbed to eliminate dangerous tags, `javascript:` pseudoprotocols, and inline event handlers before DOM insertion.

### 4. IPC & Filesystem Boundaries

- **The renderer is untrusted**: The main process accepts a path only if the user granted it — through a native file dialog, the launch argument, crash recovery, or a book already in the library. Grants are scoped to read or write and to a file or folder.
- **Sender validation**: IPC is accepted only from the main window's top-level frame on the app's own origin.
- **Native confirmation**: Sharing the OPDS catalog on the LAN and syncing with a new WebDAV host require confirmation in a native dialog the renderer cannot answer.
- **Atomic Operations**: All state writes (library catalog, reading state, annotations) use temporary staging, atomic rename, and corrupt-state quarantine.

### 5. Network Surfaces

- **OPDS server**: Loopback-only by default, with `Host` validation against DNS rebinding. LAN mode requires a random per-start access token in the URL. Read-only, with request timeouts.
- **WebDAV and OPDS clients**: Response bodies are size-capped while streaming and bounded by a deadline. Credentials are never sent across origins, WebDAV never follows redirects, and HTTPS is required for non-local WebDAV servers.
- **Sync input**: Bundles from shared folders, WebDAV and backups are validated record by record. Folder locks carry an owner token, and future-dated deletions are ignored.

### 6. Binary Hardening (Electron Fuses)

- Production packages disable `runAsNode`, `NODE_OPTIONS`, inspector flags, and extra `file://` privileges, enforcing code execution solely from validated `app.asar` archives.

### 7. DRM Boundary

ReflowPress does **not** provide DRM bypass, decryption, or circumvention tools. When a publication containing DRM encryption (`META-INF/encryption.xml` or Adobe Rights Management) is opened, ReflowPress identifies the protection layer, halts parsing gracefully, and informs the user with an explicit notification.
