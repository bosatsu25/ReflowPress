# Privacy Manifesto and Data Governance

## Core Tenet: Zero Telemetry

ReflowPress is built on a non-negotiable principle: **Your reading habits, digital library, personal annotations, and documents are strictly yours.**

- **No Analytics**: ReflowPress contains no analytics SDKs, trackers, or usage metrics collectors.
- **No Crash Beacons**: Crash recovery data is stored exclusively on your local disk in `userData/`. No stack traces or telemetry payloads are transmitted over the internet.
- **No Heartbeats**: ReflowPress does not ping any remote server on startup, shutdown, or document open events.
- **Offline First**: All parsing, reading, inspection, safe repair, indexing, and exporting features run 100% locally on your machine without an internet connection.

---

## Local Storage Locations

ReflowPress stores application state in standard user data directories designated by your operating system:

| Platform    | Location                                         | Contents                                                                        |
| :---------- | :----------------------------------------------- | :------------------------------------------------------------------------------ |
| **Windows** | `%APPDATA%\ReflowPress\`                         | `library-v1.json`, `reader-state.json`, `annotations-v1.json`, `library-cache/` |
| **macOS**   | `~/Library/Application Support/ReflowPress/`     | Same as above                                                                   |
| **Linux**   | `~/.config/ReflowPress/` (or `$XDG_CONFIG_HOME`) | Same as above                                                                   |

All files are stored in plain, human-readable JSON formats and standard image files (`covers/`). You can inspect, back up, or delete this directory at any time without proprietary tools.

---

## Network Features & Boundaries

While ReflowPress is offline-first, certain optional interoperability features communicate over local networks or user-configured endpoints:

### 1. OPDS Catalog Server

- **Default Loopback**: By default, the local OPDS server binds exclusively to `127.0.0.1` (localhost). It is completely inaccessible to external machines or other devices on your local network.
- **LAN Sharing**: If you explicitly configure the server to bind to `0.0.0.0` or a specific network interface, you must configure HTTP Basic Authentication or Access Tokens to prevent unauthorized LAN access.
- **No Cloud Relay**: ReflowPress does not route OPDS traffic through third-party proxy or relay servers.

### 2. Remote OPDS Client

- The OPDS client only communicates with feed URLs that you explicitly enter.
- Network requests are made directly from your computer to the target catalog without intermediate analytics.

### 3. WebDAV Synchronization

- The WebDAV client connects directly to your self-hosted or personal WebDAV server.
- HTTPS is strictly required for remote connections to protect credentials and payloads in transit.
- User passwords or access tokens are never transmitted to any third party and are never written to unencrypted log files.

### 4. Folder Sync (Syncthing / Dropbox)

- ReflowPress synchronizes with local filesystem directories.
- ReflowPress does not integrate proprietary cloud vendor SDKs. Whether and how that folder synchronizes with external servers is entirely controlled by your external tool (such as Syncthing, Dropbox, or Nextcloud).
