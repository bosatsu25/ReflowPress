# OPDS 2.0 Catalog & Local Server Guide

ReflowPress features a built-in Open Publication Distribution System (OPDS) server conforming to the [OPDS 2.0 specification](https://drafts.opds.io/opds-2.0.html) and Readium Web Publication Manifest. It enables seamless catalog browsing and publication streaming to mobile reader applications across your local home network without cloud lock-ins.

---

## 1. Architecture & Privacy Guarantees

- **Strictly Read-Only**: The OPDS server serves publications and cover thumbnails with HTTP `GET` and `HEAD` requests. Mutation requests (`POST`, `PUT`, `DELETE`) are rejected with `405 Method Not Allowed`.
- **Loopback Default**: By default, the server binds exclusively to `127.0.0.1`. Remote devices cannot connect until the user explicitly checks **Allow LAN access** (`0.0.0.0`) in the UI or passes `--allow-lan` in the CLI.
- **Opaque URIs**: Physical host paths (e.g. `C:\Users\...` or `/home/...`) are never exposed in feed manifests. Publications are referenced via opaque acquisition URLs:
  ```text
  http://192.168.1.100:3000/opds/v2/publications/<book-id>/acquisition
  ```
- **Byte-Range Requests**: Complies with RFC 9110 for `206 Partial Content` and `416 Range Not Satisfiable`. Reader applications can stream large audio overlays and media files efficiently without downloading entire publications at once.

---

## 2. Using the Desktop UI

1. Open ReflowPress and click the **Interop** (🔄) button in the upper toolbar.
2. Select the **OPDS 2.0 Catalog** tab.
3. Configure the listening port (default: `3000`).
4. To allow reading on your phone or tablet on the same Wi-Fi, check **Allow LAN access (bind 0.0.0.0)**.
5. Click **Start OPDS Server**. The active connection URL (e.g. `http://192.168.1.50:3000`) will be displayed with a convenient copy button.
6. Open your favorite mobile OPDS client and add a new catalog pointing to that URL.

---

## 3. CLI Usage

### Starting the OPDS Server

```bash
# Bind to loopback (local machine only)
reflowpress opds serve --port 3000 --catalog ~/.reflowpress/library-v1.json

# Allow other devices on your home Wi-Fi network
reflowpress opds serve --port 8080 --allow-lan --catalog ~/.reflowpress/library-v1.json
```

### Inspecting Remote OPDS Feeds

```bash
# Fetch and validate a remote OPDS 2.0 or 1.2 feed
reflowpress opds fetch https://standardebooks.org/opds/all
```

---

## 4. Client Application Compatibility & Protocol Support

ReflowPress validates its local OPDS server output against the Readium Web Publication Manifest and OPDS 2.0 specifications. The table below distinguishes between automated specification verification and expected interoperability:

| Application          | Platform                  | Target Protocol | Compatibility Status               |
| :------------------- | :------------------------ | :-------------- | :--------------------------------- |
| **Thorium Reader**   | Desktop (Win/macOS/Linux) | OPDS 2.0 JSON   | Verified Compatible (Readium Spec) |
| **Moon+ Reader Pro** | Android                   | OPDS 2.0 / 1.2  | Expected (Protocol-Compliant)      |
| **Foliate**          | Linux Desktop             | OPDS 2.0 JSON   | Expected (Protocol-Compliant)      |
| **Panels**           | iOS / iPadOS              | OPDS 2.0 JSON   | Expected (Protocol-Compliant)      |
| **KyBook 3**         | iOS                       | OPDS 1.2 / 2.0  | Expected (Protocol-Compliant)      |
| **FBReader**         | Android / iOS / Desktop   | OPDS 1.2 / 2.0  | Expected (Protocol-Compliant)      |

For detailed test methodologies, empirical test logs, and guidelines for certifying third-party readers, see [Compatibility Testing](file:///c:/Users/tkmnk/GitHub/ReflowPress/docs/compatibility-testing.md).
