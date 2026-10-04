# Release Engineering and Distribution Process

This document defines the formal checklist and standard operating procedure for creating, verifying, and publishing ReflowPress stable releases.

---

## 1. Prerequisites and Release Philosophy

ReflowPress follows a strict release hardening philosophy:

- **No release is cut while automated tests or verification gates are failing.**
- **No release is published without cross-platform packaging and smoke test verification.**
- **Every release artifact must have an accompanying cryptographic SHA-256 checksum.**

---

## 2. Release Verification Gate (`release:check`)

Prior to merging any release candidate branch or creating a release tag, run the unified verification aggregator:

```bash
pnpm release:check
```

This single command executes all critical release gates in sequence:

1. `pnpm test:version`: Verifies version parity across root `package.json`, workspace packages, and `core/version.ts`.
2. `pnpm test:api`: Validates that public API contracts across all 16 `@reflowpress/*` packages remain unviolated.
3. `pnpm audit --prod`: Confirms zero high or critical production vulnerabilities.
4. `pnpm lint`: Checks code styling and formatting.
5. `pnpm typecheck`: Ensures TypeScript strict type safety across all packages.
6. `pnpm test`: Executes all unit and integration test suites.
7. `pnpm build`: Builds production TypeScript distributions and renderer assets.
8. `pnpm analyze:bundle`: Enforces bundle size limits (< 500 kB renderer chunk).
9. `pnpm bench`: Validates performance budgets for 1,000-book library operations.
10. `pnpm test:visual`: Validates Playwright visual regression snapshots.

---

## 3. Packaging & Distribution Artifacts

Package the distribution binaries for the target operating systems:

```bash
# Unpacked directory inspection
pnpm package:dir

# Windows (NSIS Installer and Portable Executable)
pnpm package:win

# macOS (DMG and ZIP)
pnpm package:mac

# Linux (AppImage and DEB)
pnpm package:linux
```

All artifacts are generated into the `release-artifacts/` directory.

---

## 4. Packaging Smoke Test

Verify that the generated binaries and ASAR archives are structurally sound:

```bash
pnpm smoke:package
```

This verifies that:

- The executable exists and is non-empty (> 10 MB).
- `app.asar` contains valid entry points (`main.js`, `preload.cjs`, `index.html`) and required workspace dependencies.
- Electron Fuses are correctly embedded in the binary.

---

## 5. Checksum Generation

Compute deterministic SHA-256 digests for all distribution packages:

```bash
pnpm release:checksums
```

This writes `release-artifacts/SHA256SUMS.txt` formatted for standard UNIX `sha256sum` verification.

---

## 6. Tagging and Publishing Flow

Once all gates pass on the release branch and the PR is approved:

1. **Merge PR** into `main`.
2. **Create Git Tag**:
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. **CI Release Workflow**:
   - Pushing the `v*.*.*` tag automatically triggers `.github/workflows/release.yml`.
   - The workflow compiles the matrix binaries on Windows, macOS, and Linux runners, runs `pnpm release:checksums`, and attaches the resulting packages to the GitHub Release.
