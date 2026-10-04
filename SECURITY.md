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

### 1. Process Isolation & Renderer Sandboxing

- **Context Isolation**: Always enabled (`contextIsolation: true`).
- **No Node Integration**: Renderers never have access to Node.js APIs (`nodeIntegration: false`).
- **Sandbox**: Enabled (`sandbox: true`).
- **Strict Preload**: Only typed, schema-validated IPC wrappers are exposed via `contextBridge`.

### 2. Strict Content Security Policy (CSP)

The Desktop application enforces an unyielding Content Security Policy in `index.html`:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self' data:;
connect-src 'self' http://127.0.0.1:* http://localhost:*;
frame-src 'self' blob: data:;
object-src 'none';
base-uri 'none';
form-action 'none';
```

- Remote script execution is completely blocked.
- Untrusted plugins (`<object>`, `<embed>`) are disabled.

### 3. XML & Publication Security

- **XXE and DTD Defense**: The publication loader (`@reflowpress/epub`) uses strict XML parsing without external entity resolution or parameter entity expansion.
- **Zip-Slip & Traversal Prevention**: File extraction verifies that normalized archive entries remain strictly contained within their designated target root.
- **Sanitized XHTML**: Reader content is scrubbed to eliminate dangerous tags, `javascript:` pseudoprotocols, and inline event handlers before DOM insertion.

### 4. IPC & Filesystem Boundaries

- **Extension & Path Whitelisting**: IPC endpoints for file inspection, publication loading, and export reject paths outside expected extensions or traversal sequences (`..`).
- **Atomic Operations**: All state writes (library catalog, reading state, annotations) use temporary staging, atomic rename, and corrupt-state quarantine.

### 5. Binary Hardening (Electron Fuses)

- Production packages disable `runAsNode`, `NODE_OPTIONS`, and inspector flags, enforcing code execution solely from validated `app.asar` archives.

### 6. DRM Boundary

ReflowPress does **not** provide DRM bypass, decryption, or circumvention tools. When a publication containing DRM encryption (`META-INF/encryption.xml` or Adobe Rights Management) is opened, ReflowPress identifies the protection layer, halts parsing gracefully, and informs the user with an explicit notification.
