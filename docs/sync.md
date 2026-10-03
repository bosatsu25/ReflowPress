# Multi-Device Synchronization & Data Portability Guide

ReflowPress provides multi-device synchronization without relying on proprietary cloud services or centralized vendor accounts. In accordance with local-first and privacy-first principles, synchronization is achieved via user-owned shared storage:

- **Shared Local / Network Folder**: Syncthing, Dropbox, Google Drive, iCloud Drive, or network shares (SMB/NFS).
- **WebDAV Remote Server**: Nextcloud, ownCloud, or any standard RFC 4918 server.

---

## 1. Synchronization Architecture

ReflowPress employs a decentralized **3-Way Merge Engine** across three snapshots:

- **Base Snapshot**: The common ancestor snapshot recorded at the last synchronization.
- **Local Snapshot**: The current local catalog, reading progress, and annotations on this machine.
- **Remote Snapshot**: The snapshot found in the target sync folder or WebDAV storage.

### Data Model & Machine Independence

- **Portable Publication IDs**: Local filesystem paths (`C:\Users\...` or `/home/...`) are never used as sync keys. Publications are keyed deterministically by canonical publication identifiers (ISBN, UUID) or SHA-256 content hashes (`fp-...`).
- **Atomic Bundles**: All metadata, bookmarks, annotations, and tombstones are serialized into human-readable atomic JSON files within `.reflowpress-sync/` or exported as portable `.json` backup bundles.
- **Lease Locks**: Folder sync coordinates concurrent writers using `.sync.lock` containing process metadata and timestamps, recovering automatically from stale locks after 15 minutes.

---

## 2. Zero Silent Data Loss & Conflict Resolution

If a publication or note is modified on two devices simultaneously before syncing, ReflowPress refuses to silently overwrite user data:

1. Both versions are recorded in a structured `ConflictRecord`.
2. When applying sync in the UI or CLI, users choose their resolution policy:
   - `keep-local`: Local modifications take precedence.
   - `keep-remote`: Remote modifications take precedence.
   - `keep-both`: Both versions are preserved (remote copies are cleanly suffixed with `[Remote Copy]`).

---

## 3. Supported Sync Backends

### A. Shared Folder Sync (Syncthing / Dropbox / iCloud)

1. In ReflowPress, open **Interop** (🔄) → **Library Sync** tab.
2. Select **Shared Folder Sync**.
3. Choose or browse to your Syncthing or Dropbox shared folder path (e.g. `~/Sync/ReflowPress`).
4. Click **Sync Folder Now**.

**CLI Command:**

```bash
# Sync with a Syncthing synchronized directory
reflowpress sync folder --target /path/to/sync/dir --catalog ~/.reflowpress/library-v1.json

# Dry-run preview of additions, updates, and conflicts
reflowpress sync folder --target /path/to/sync/dir --dry-run
```

### B. WebDAV Remote Sync (Nextcloud / ownCloud)

ReflowPress speaks native WebDAV (RFC 4918) via HTTP methods `MKCOL`, `PROPFIND`, `GET`, and `PUT`.

**Security Rules:**

- HTTPS is strictly required for non-localhost remote servers.
- Passwords are never passed as command-line flags. Use environment variables:
  ```bash
  export REFLOWPRESS_WEBDAV_PASSWORD="your-app-password"
  reflowpress sync webdav \
    --url "https://cloud.example.com/remote.php/dav/files/alice/ReflowPress/" \
    --user "alice"
  ```
- URL masking ensures logs, errors, and terminal outputs mask secrets as `https://user:***@host/...`.

---

## 4. Backup & Restore Workbenches

You can export your complete library index, tags, collections, reading positions, and annotations to a single offline backup bundle:

### Exporting Backup

```bash
reflowpress backup --output ./my-reflowpress-backup.json
```

### Previewing & Restoring Backup

```bash
# Preview what would be added or changed
reflowpress restore ./my-reflowpress-backup.json --preview

# Apply restore with conflict resolution policy
reflowpress restore ./my-reflowpress-backup.json --policy keep-both
```
