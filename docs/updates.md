# ReflowPress Update Policy and Distribution Model

## Core Philosophy: Local-First and User-Directed

ReflowPress strictly adheres to a **local-first, privacy-first, zero-telemetry** design. In accordance with these tenets:

1. **Zero Silent Network Activity**: ReflowPress never establishes background network connections to check for updates without explicit user consent.
2. **Zero Automatic Installs**: ReflowPress will never download, patch, or restart the application silently in the background.
3. **Reproducible and Verifiable**: Every official release artifact is published alongside cryptographic SHA-256 checksums (`SHA256SUMS.txt`).

---

## Update Strategies

### 1. Manual Verification (Recommended)

Users can verify their current version by running:

```bash
reflowpress --version
```

or inspecting the **Help → About** dialog within the Desktop workbench.

New stable releases are announced on the official GitHub Releases page:
`https://github.com/bosatsu25/ReflowPress/releases`

To upgrade:

1. Download the new installer or portable binary matching your operating system.
2. Verify the SHA-256 checksum against `SHA256SUMS.txt`.
3. Install or extract the updated binary. All user data (`userData/library-v1.json`, `userData/reader-state.json`, `userData/annotations-v1.json`) is maintained independently in the OS user profile directory and survives application upgrades automatically.

### 2. Auto-Updater Deferment Rationale

Automated background updates (e.g., continuous polling via `electron-updater`) are intentionally **deferred post-1.0** for the following architectural and security reasons:

- **Offline Independence**: Many ReflowPress users operate in air-gapped, offline, or metered connection environments.
- **Supply-Chain Verification**: Manual verification ensures users can validate cryptographic signatures and checksums prior to binary execution.
- **Data Migration Transparency**: When schema migrations occur, users maintain full control over when to upgrade their local database files.
