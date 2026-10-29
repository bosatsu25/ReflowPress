# ReflowPress Troubleshooting & Support Guide

This guide addresses common questions, operating conditions, and recovery procedures in ReflowPress.

---

## 1. Storage & Persistence Issues

### "Unsupported Schema Version / Upgrade Required"

- **Symptom**: Application warns that a library catalog, annotation store, reading position, or sync bundle cannot be loaded because its schema version is higher than supported.
- **Cause**: The data was created or updated by a newer version of ReflowPress.
- **Solution**: ReflowPress preserves newer data completely intact without overwriting or quarantining it. To access this data, please update your ReflowPress installation to the latest version.

### "Corrupt File Detected & Quarantined"

- **Symptom**: A notification warns that `library-v1.json` or `annotations-v1.json` was corrupt and quarantined.
- **Cause**: Physical disk truncation, process killed mid-unbuffered write, or manual manual edit introduced malformed JSON syntax.
- **Behavior**: ReflowPress moves the broken file to `<name>.json.corrupt-<timestamp>` so that original data is never lost, and initializes a clean store.
- **Recovery**: You can inspect the `.corrupt-*` file in your text editor, fix syntax errors, and restore entries or import them via the CLI / UI.

---

## 2. Crash Recovery & Session Management

### "ReflowPress recovered from an unexpected shutdown" Banner

- **Symptom**: On startup, a blue recovery banner appears asking if you would like to restore your previous workspace.
- **Cause**: The prior session ended without writing a clean exit marker (due to power outage, OS force kill, or crash).
- **Action**: Click **Restore Workspace** to return to the book and page you were reading, or click **Dismiss** to proceed to the main library catalog.
- **Temporary Files Janitor**: During startup after an ungraceful shutdown, ReflowPress automatically detects and removes leftover `.tmp-*` files to preserve disk space.

---

## 3. Publication Inspection & Repair

### "EPUB-MIME-001: Mimetype entry missing, compressed, or invalid offset"

- **Issue**: The EPUB archive violates the OCF standard requirement that `mimetype` must be stored uncompressed as the first file at byte offset 38.
- **Remediation**: Run `reflowpress repair book.epub --apply` to automatically generate a compliant archive with the exact standard header.

### "EPUB-NAV-001: Missing EPUB 3 Navigation Document"

- **Issue**: The book lacks an EPUB 3 Navigation Document (`properties="nav"`), making it difficult for modern e-readers to display a structured table of contents.
- **Remediation**: Run `reflowpress repair book.epub --apply` to synthesize a navigation document from existing EPUB 2 NCX toc data.

### "PDF Quality Gate: Text density or extraction failure"

- **Issue**: An exported or inspected PDF fails the Quality Gate baseline profile.
- **Cause**: The source publication contains pure scanned image pages without text layers, or font extraction failed.
- **Remediation**: Ensure the source EPUB contains text elements rather than pure full-page images.

---

## 4. Networking, OPDS & Sync

### Cannot connect to local OPDS server from another device

- **Issue**: OPDS reader on mobile phone or tablet cannot connect to `http://<ip>:8080/opds`.
- **Cause**: By default, ReflowPress binds to the loopback interface (`127.0.0.1`) for local security.
- **Solution**: Add the `--allow-lan` flag when starting the server to bind to `0.0.0.0`:
  ```sh
  reflowpress opds serve --port 8080 --catalog ./library.json --allow-lan
  ```
  Ensure your operating system firewall allows inbound traffic on port 8080 for private networks.
- **Access token**: In LAN mode the catalog URL contains a random token that changes on every start, e.g. `http://<ip>:8080/<token>/opds/v2/catalog`. Requests without it return `404`. Copy the full URL printed by the CLI (or shown in the app) into your reader, replacing `localhost` with the computer's LAN address.
- **`421 Misdirected Request`**: Without `--allow-lan`, the server only answers requests addressed to `127.0.0.1`, `localhost` or `[::1]`. Requests sent under any other host name are refused on purpose (DNS rebinding protection).

### WebDAV Sync Authentication

- **Issue**: WebDAV sync fails with 401 Unauthorized.
- **Solution**: For security, ReflowPress never passes passwords as command-line arguments. Set the environment variable `REFLOWPRESS_WEBDAV_PASSWORD` before initiating sync:
  ```sh
  export REFLOWPRESS_WEBDAV_PASSWORD="your-secure-password"
  reflowpress sync webdav --url https://webdav.example.com/remote.php/webdav --user myuser
  ```

### WebDAV sync fails with "HTTP 301/302/307/308"

- **Cause**: ReflowPress never follows WebDAV redirects, so credentials and uploads only go to the server you configured.
- **Solution**: Use the final URL the server redirects to (often the `https://` form, or the same path with a trailing `/`).

### "Sync folder is locked by another process"

- **Cause**: Another ReflowPress instance is syncing with the same folder. Locks expire after 15 minutes if that instance crashed.
- **Solution**: Wait for the other sync to finish. Do not delete `.sync.lock` while another machine may be writing.

---

## 5. Export

### PDF export fails with "Failed to launch headless Chromium with its sandbox enabled"

- **Cause**: PDF export renders books in Chromium with its OS sandbox enabled, so a malicious publication cannot reach the rest of the system. Some Linux systems block the user namespaces the sandbox needs — notably Ubuntu 23.10 and later, through AppArmor — and when the export runs as root the sandbox is refused outright.
- **Solution** (prefer the first):
  1. Allow unprivileged user namespaces: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (add it to `/etc/sysctl.d/` to make it permanent).
  2. Or explicitly run the renderer without the sandbox, accepting the reduced isolation, for example in a container that is already isolated:
     ```sh
     REFLOWPRESS_CHROMIUM_NO_SANDBOX=1 reflowpress export book.epub --format pdf
     ```
     The export result then carries a warning that the sandbox was disabled.

### Links or remote images are missing from exported HTML/PDF

- **Cause**: Exports are self-contained and offline. Remote images, media, external hyperlinks and `srcset` are removed, scripts and event handlers are stripped, and a strict Content Security Policy is embedded. Only links within the book and images inside the publication are kept.

---

## 6. Hardware E-Reader USB Transfers

### Device Not Detected

- **Issue**: `reflowpress device list` does not detect your connected Kindle, Kobo, or PocketBook.
- **Checklist**:
  1. Ensure the e-reader is connected via USB and is in **Mass Storage / File Transfer** mode (look for the "Connect / Transfer files" prompt on the device screen).
  2. For Amazon Kindle: ReflowPress conservatively requires both `documents/` and `system/` (or `.kindle`) to exist at the mount root to avoid mistaking random USB flash drives for a Kindle.
  3. Ensure you specify the correct mounted volume path (e.g. `E:\` or `D:\` on Windows, `/Volumes/KOBOeReader` on macOS, or `/media/user/...` on Linux).
  4. Note: Devices connected strictly via MTP (Media Transfer Protocol) are not exposed as POSIX block volumes and must be mounted as USB Mass Storage.
