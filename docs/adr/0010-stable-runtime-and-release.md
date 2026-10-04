# ADR 0010: Stable Runtime, Crash Recovery, and Release Hardening

## Status

Accepted

## Context

ReflowPress 1.0 represents the transition from active feature development (Milestones 0.1 through 0.9) to a hardened, production-grade stable release. A core commitment of ReflowPress is **User Data Safety and Reliability**: the application must behave predictably even in adverse operating conditions such as unexpected process termination, sudden power loss, OS crashes, or hardware disconnects.

Prior to 1.0, while file writes were atomic (write to `.tmp-*` followed by `fsync` and `rename`), an ungraceful crash could leave orphaned temporary files on disk, and the application had no formal mechanism to detect whether the previous session terminated cleanly or crashed. Furthermore, users who experienced an unexpected crash lost their active reading workspace context.

## Specification References & Verification (Access Date: October 2026)

1. **POSIX File System Crash Consistency & Atomic Renames**:
   - `fsync()` flushing dirty pages to persistent storage prior to atomic directory link swapping via `rename()`.
   - Temporary file naming conventions with non-colliding process-unique identifiers.
2. **Electron Security Guidelines**:
   - Electron 33.x Application Security Architecture: context isolation, sandboxing, session privilege restrictions, CSP enforcement, navigation lockouts.
   - Reference: `https://www.electronjs.org/docs/latest/tutorial/security`
3. **SemVer 2.0.0 Specification**:
   - Canonical version numbering and public API freeze rules.

---

## Decisions

### 1. Clean Shutdown Marker Protocol

ReflowPress implements a deterministic marker protocol in `app.getPath("userData")`:

- **Marker File**: `.clean-shutdown` (contains JSON timestamp of clean exit).
- **Session File**: `.active-session.json` (contains PID, startup timestamp, and last active view/publication).
- **Startup Logic**:
  1. ReflowPress inspects `userData`.
  2. If `.active-session.json` exists but `.clean-shutdown` does NOT exist, ReflowPress determines that the prior session suffered an abnormal termination (crash, power loss, or force kill).
  3. ReflowPress sets a `crashedLastSession` flag, cleans up the stale `.clean-shutdown` marker if present, and writes a fresh `.active-session.json`.
- **Shutdown Logic**:
  1. On `before-quit` or `will-quit`, ReflowPress writes `.clean-shutdown` synchronously or via flushable async write.
  2. Removes `.active-session.json`.

### 2. Temporary Artifact Janitor

Atomic file writes create temporary files with the prefix `.tmp-` or `.tmp.*` (e.g. `library-v1.json.tmp-179107...`). When an ungraceful shutdown occurs during a write, these files remain on disk indefinitely.

On every application startup, the **Temporary Artifact Janitor**:

1. Scans `userData` and configured cache directories (`library-cache/`).
2. Identifies all files matching `*.tmp-*` or `*.tmp.*`.
3. Safely deletes them to prevent disk storage bloat.

### 3. Safe Workspace Session Restoration

ReflowPress records lightweight workspace state in `.active-session.json` (or reader position store):

- Last opened publication file path / ID
- Reading position and section index
- Active view mode (library vs reader)

When a crash is detected on startup:

- The UI exposes a non-intrusive recovery notification: _"ReflowPress recovered from an unexpected shutdown. Restore previous workspace?"_
- Accepting restores the previous publication and reading position; dismissing starts at the library catalog.

### 4. IPC & Security Boundaries

To maintain release-grade security:

- `contextIsolation: true` and `sandbox: true` are strictly enforced on all windows.
- In-memory preload script exposes only typed, explicit invoke methods.
- All file dialogs and paths are validated against path traversal attacks.

---

## Consequences

- Prevents disk space leakage from orphaned temporary files across crashes.
- Clear diagnostics on whether a crash occurred, enabling intelligent workspace restoration.
- No impact on normal startup latency (< 5ms for marker check and directory sweep).
