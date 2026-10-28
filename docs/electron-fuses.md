# Electron Fuses Specification and Hardening Guide

## Overview

Electron Fuses provide binary-level hardening by flipping immutable configuration bits inside the packaged Electron binary during compilation. This prevents malicious scripts, third-party libraries, or attackers with filesystem access from tampering with runtime security properties.

ReflowPress configures Electron Fuses in `electron-builder.yml` to enforce a strict security boundary for production desktop builds.

---

## Active Fuse Configuration

| Fuse Name                               |  Value  | Hardening Rationale                                                                                                                                                                          |
| :-------------------------------------- | :-----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAsNode`                             | `false` | Disables the `ELECTRON_RUN_AS_NODE=1` environment variable. Prevents attackers from using the ReflowPress binary as a standalone Node.js interpreter to execute arbitrary untrusted scripts. |
| `enableCookieEncryption`                | `true`  | Enforces OS-level encryption for Chromium cookies and storage items via DPAPI (Windows) or Keychain (macOS).                                                                                 |
| `enableNodeOptionsEnvironmentVariable`  | `false` | Disables `NODE_OPTIONS` environment variable handling. Prevents hostile process injection or preload scripts via environment manipulation.                                                   |
| `enableNodeCliInspectArguments`         | `false` | Disables `--inspect`, `--inspect-brk`, and related Node.js V8 inspector arguments in production binaries.                                                                                    |
| `enableEmbeddedAsarIntegrityValidation` | `true`  | Validates the SHA-256 header hash of `app.asar` before mounting it, ensuring application code has not been tampered with.                                                                    |
| `onlyLoadAppFromAsar`                   | `true`  | Forces Electron to load all application resources strictly from `app.asar`. Prevents loose script file execution from unpacked directories.                                                  |

---

## Verification

When `pnpm package:dir` or `pnpm package` runs, `electron-builder` automatically executes `@electron/fuses` against the packaged executable:

```text
• executing @electron/fuses electronPath=release-artifacts\win-unpacked\ReflowPress.exe
```

Attempting to launch the packaged binary with `ELECTRON_RUN_AS_NODE=1` or `NODE_OPTIONS` will be completely ignored or safely rejected by the hardened runtime.
