# Code Signing Policy and Verification Guide

## Executive Summary

ReflowPress binaries built via public open-source CI workflows are currently distributed **without commercial EV (Extended Validation) code-signing certificates**.

To ensure data integrity and prevent supply-chain tampering without relying on costly commercial certificate authorities, ReflowPress relies on **cryptographic SHA-256 checksums** published alongside every official release.

---

## Platform Status & Security Prompts

### 1. Windows (Authenticode)

- **Signing Status**: Unsigned / Developer Self-Signed in automated builds.
- **User Prompt**: Windows Defender SmartScreen may display:
  > _"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."_
- **Bypassing the Warning**:
  1. Click **More info**.
  2. Verify that the publisher says ReflowPress or Unknown Publisher.
  3. Click **Run anyway**.
- **Integrity Verification**: Verify that the SHA-256 hash of `ReflowPress-Setup-1.0.0.exe` or `ReflowPress-1.0.0-portable.exe` exactly matches the digest in `SHA256SUMS.txt`.

### 2. macOS (Apple Developer ID & Notarization)

- **Signing Status**: Unsigned / Ad-hoc signed in automated builds. Notarization requires an active Apple Developer Program account.
- **User Prompt**: macOS Gatekeeper may display:
  > _"ReflowPress cannot be opened because Apple cannot check it for malicious software."_
- **Bypassing the Warning**:
  1. Open **System Settings → Privacy & Security**.
  2. Scroll to the **Security** section where ReflowPress is listed.
  3. Click **Open Anyway** and enter your macOS administrator password.
- **Integrity Verification**: Run `shasum -a 256 ReflowPress-1.0.0-mac-*.dmg` and verify against `SHA256SUMS.txt`.

### 3. Linux (AppImage / DEB)

- **Signing Status**: Distributed as standard AppImage and Debian packages.
- **Integrity Verification**: Run `sha256sum ReflowPress-1.0.0-linux-*.AppImage` and match with `SHA256SUMS.txt`.

---

## Verifying Release Checksums

You can verify the authenticity and integrity of downloaded files on any platform:

### On Windows (PowerShell)

```powershell
Get-FileHash -Algorithm SHA256 .\ReflowPress-Setup-1.0.0.exe
```

### On macOS & Linux (Terminal)

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

If the checksum matches, your binary is identical to the build produced by our continuous integration pipeline.
