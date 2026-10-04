# ReflowPress Canonical Versioning & Release Policy

**Date**: October 2026  
**Status**: Active  
**Applies to**: ReflowPress Monorepo (`apps/`, `packages/`, CLI, Desktop)

---

## 1. Versioning Scheme

ReflowPress strictly follows [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- **MAJOR**: Incompatible API modifications, breaking persistence schema shifts requiring manual data intervention, or removal of deprecated features.
- **MINOR**: Backward-compatible new capabilities, new quality diagnostic rules, export format additions, or device adapter support.
- **PATCH**: Backward-compatible bug fixes, security patches, performance optimizations, or documentation corrections.

---

## 2. Monorepo Lockstep Versioning

All workspace packages (`@reflowpress/*`), executable applications (`@reflowpress/cli`, `@reflowpress/desktop`), and the root repository adhere to **unified lockstep versioning**:

- Every `@reflowpress/*` package carries the exact same version number.
- Cross-package internal dependencies use `workspace:*` specifiers in `package.json`.
- Distribution installers and CLI binaries report the unified version string.

---

## 3. Single Source of Truth

The canonical version is declared in TypeScript at:

```typescript
// packages/core/src/version.ts
export const REFLOWPRESS_VERSION = "0.1.0";
```

All runtime components (`@reflowpress/quality`, `@reflowpress/repair`, `@reflowpress/cli`) import `REFLOWPRESS_VERSION` directly rather than hardcoding version strings or parsing untyped JSON at runtime.

---

## 4. Automated Synchronization & Verification

1. **Continuous Check**:

   ```bash
   pnpm test:version
   # or via Vitest:
   pnpm test tests/unit/version.test.ts
   ```

   Validates that root `package.json`, all 17 package `package.json` files, and `packages/core/src/version.ts` match.

2. **Atomic Version Bump**:
   ```bash
   node scripts/bump-version.js 1.0.0
   ```
   Atomically updates `packages/core/src/version.ts`, the root `package.json`, and all package manifests in a single deterministic pass.

---

## 5. Post-1.0 Stability & Compatibility Commitments

Starting with ReflowPress 1.0:

1. **Persistence Immutability & Upgrade Safety**:
   - Schema version increments must be accompanied by non-destructive forward migrations.
   - Files with newer schema versions (`schemaVersion > current`) are flagged as `UPGRADE_REQUIRED` and NEVER quarantined as corrupt.
2. **Public API Contracts**:
   - The root exports of `@reflowpress/core`, `@reflowpress/epub`, `@reflowpress/pdf`, and `@reflowpress/typography` remain stable across minor releases.
3. **CLI Determinism**:
   - Standard flags (`--format`, `--json`, `--quiet`, `--version`, `--help`) and exit codes (`0`, `1`, `2`) are frozen contracts.
