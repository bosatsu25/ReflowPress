# Physical E-Reader Device Transfer & Hardware Integration

ReflowPress provides dedicated support for transferring publications directly to connected hardware e-readers, tablets, and external storage devices.

---

## 1. Supported Device Profiles

ReflowPress automatically inspects the target mount point or drive root for hardware vendor markers:

| Device Family           | Hardware Markers           | Books Directory   | Supported Formats | Transfer Behavior                                                           |
| :---------------------- | :------------------------- | :---------------- | :---------------- | :-------------------------------------------------------------------------- |
| **Amazon Kindle**       | `documents/`               | `documents`       | PDF (AZW3 / MOBI) | Copies to `documents/`. Warns if sending reflowable EPUB directly over USB. |
| **Rakuten Kobo**        | `.kobo/`                   | Root / subfolders | EPUB, KEPUB, PDF  | Scans root or subdirectories. Preserves standard `.epub` naming.            |
| **PocketBook**          | `system/` or `Pocketbook/` | `Books`           | EPUB, PDF         | Copies directly to `Books/` partition.                                      |
| **Generic USB Storage** | Fallback                   | Root              | EPUB, PDF         | Default fallback for Android mounts, flash drives, and external SSDs.       |

---

## 2. Integrity & Safety Guarantees

- **Transactional Staging**: Files are written first to `.tmp-transfer-...` temporary files and verified before atomic renaming into place.
- **SHA-256 Checksums**: Both source and destination data are validated. Identical files on the target device are automatically skipped without re-writing flash storage.
- **Collision Protection**: If a file with the same name exists but has different contents or size, ReflowPress marks it as a conflict and refuses to silently overwrite it.
- **Path Traversal Containment**: Directory escape sequences (`..`) and absolute destination filenames are strictly blocked, preventing writes outside the designated device root.

---

## 3. Using the Desktop UI

1. Connect your e-reader to your computer via USB and select **Connect** or **File Transfer / Mass Storage Mode** on the device screen.
2. In ReflowPress, open **Interop** (🔄) → **E-Reader Devices** tab.
3. Select or enter the device drive or mount path (e.g. `E:\`, `/Volumes/KOBOeReader`, or `/media/user/Kindle`).
4. Click **Detect Device**. The detected profile (e.g. _Amazon Kindle_ or _Rakuten Kobo_) and available storage space will be displayed.
5. Select the publications you wish to transfer and click **Transfer Selected Books**.

---

## 4. CLI Usage

### Discovering Devices

```bash
reflowpress device list --target /Volumes/KOBOeReader
```

### Transferring Publications

```bash
# Transfer single publication with dry-run verification
reflowpress device send /Volumes/KOBOeReader my-book.epub --dry-run

# Transfer and execute safe copy
reflowpress device send /Volumes/KOBOeReader my-book.epub
```

---

## 5. MTP (Media Transfer Protocol) Capability Boundary

### Technical Spike Evaluation (Milestone 0.9)

During the Milestone 0.9 technical spike, direct user-space MTP wire protocol implementations were analyzed across three primary options:

1. **Windows Portable Devices (WPD)**: Requires native Win32 COM/C++ addons with complex Single-Threaded Apartment (STA) threading models. Non-portable to macOS or Linux.
2. **libmtp Bindings**: Unmaintained Node.js native bindings; on Windows, installing `WinUSB` filter drivers replaces standard MTP drivers, breaking Windows Explorer integration for the device.
3. **Distribution & Packaging**: Precompiled native C/C++ addons complicate cross-platform CI, release binaries, and binary signing across Windows, macOS (Intel/Apple Silicon), and Linux.

### Engineering Decision

To maintain ReflowPress's zero-crash safety and zero-native-addon distribution guarantees, **direct MTP wire protocol implementation is deferred**.

When modern Android or MTP-only devices are connected:

- Switch the USB mode on the device to **USB Mass Storage** or **Mount Storage**.
- On Linux, use OS-level mounting utilities (such as `jmtpfs` or `gvfs-mount`) to mount the device to a local directory, then point ReflowPress to the mounted directory.
