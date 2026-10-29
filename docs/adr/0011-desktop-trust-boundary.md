# ADR 0011: Desktop Trust Boundary and Runtime Choice

## Status

Accepted (October 2026)

## Context

Up to 1.0.0 the desktop main process trusted the renderer completely. The
preload bridge passed file paths from the renderer straight to `fs` calls.
A script running in the renderer could therefore read, write or overwrite
any file the user can: through a crafted EPUB that slips past the
sanitizer, a pdf.js bug, or a compromised dependency. Context isolation,
the sandbox and CSP only make it harder to get code running in the
renderer. Once code runs there, they do not limit what it can ask the main
process to do.

A security audit after 1.0.0 also found weaknesses in the code that faces
the network and in the code that reads files:

- The OPDS server could be read by websites through DNS rebinding. In LAN
  mode it had no authentication, and it leaked file descriptors.
- WebDAV requests had no limit on response size or on time spent reading
  the body.
- Sync bundles were trusted without validation.
- Several parsers in the quality, repair, export and search code had ReDoS
  and resource-exhaustion paths.

This review also asked whether a different runtime would remove these
classes of problem instead of patching them.

## Decision 1: Keep Electron

Alternatives considered:

| Option                             | What it would give                                                                                      | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri (system WebView + Rust core) | Smaller binary; a capability-based IPC model built in; no Node in the main process                      | The rendering engine changes per OS: WebView2 (Chromium) on Windows, WebKitGTK on Linux. Vertical Japanese text (`writing-mode: vertical-rl`, ruby, `text-combine-upright`) renders differently in WebKitGTK. PDF export runs in Chromium (ADR 0007), so the reader preview and the exported PDF would stop matching. Every `@reflowpress/*` package (ZIP, sync, OPDS, device) would have to be rewritten in Rust or run in a Node sidecar, which brings Node back. |
| .NET (WPF/WinUI + WebView2)        | Native Windows shell                                                                                    | Windows only, so the Linux distribution is lost. The same full rewrite of the TypeScript core. Still Chromium underneath, so no gain in rendering.                                                                                                                                                                                                                                                                                                                  |
| Electron (current)                 | Same Chromium for the reader and for PDF export on every OS; the TypeScript core is shared with the CLI | Large binary (~130 MB). The Chromium version must be kept current.                                                                                                                                                                                                                                                                                                                                                                                                  |

The decisive requirement is identical rendering of vertical Japanese text
across platforms and between the reader and the exported PDF. Of the three
options, only Electron meets it without a rewrite. The security advantage
of Tauri comes from its capability model, which Decision 2 reproduces.
Switching runtimes would not have removed the parser and network findings
above: they are in our own code and would move with it.

Consequence: Electron must be kept on a supported major version. Electron
supports the latest three majors, and a new major ships about every eight
weeks. ReflowPress needs a release at least that often, even when there
are no features to ship, to pick up Chromium security fixes.

## Decision 2: Capability-based IPC

The renderer is treated as untrusted. The main process accepts a file
system path only if the user granted it through a channel the renderer
cannot forge:

- **Grants** (`apps/desktop/src/main/security/path-grants.ts`): a path
  becomes usable only after one of these:
  - it is returned by a native open or save dialog;
  - it is passed as the launch argument;
  - it is the crash-recovery path;
  - it is a book already in the catalog that the user added earlier.
- Each grant is for **read** or **write**, and for a single file or a
  directory tree. Containment is checked with `path.relative`, and paths
  are compared case-insensitively on Windows.
- **Sender validation** (`ipc-guard.ts`): every IPC handler checks that
  the message comes from the main window's top-level frame, loaded from
  the app's own origin. Messages from iframes and from other origins are
  rejected.
- **Native confirmation**: two actions that send data off the machine need
  a native dialog that the renderer cannot answer:
  - sharing the OPDS catalog on the LAN;
  - syncing with a WebDAV host for the first time.
- **Narrow handlers**:
  - The renderer can no longer overwrite the whole catalog (the
    `library:save` handler was removed).
  - Book updates accept only `lastOpened`, `tags` and `readingProgress`.
  - Sync results keep local file paths instead of trusting remote data.

## Decision 3: A custom `app://` protocol instead of `file://`

The renderer is served from `app://reflowpress/`. The handler is
registered as a privileged, standard, secure scheme and serves only files
under the renderer build directory. Every response carries the CSP as a
header as well, plus `nosniff`.

`file://` pages share one origin with every local file. The
`grantFileProtocolExtraPrivileges` fuse is now off, so `file://` gets no
special treatment.

Each session also gets these protections:

- All permission requests are denied.
- Every network request outside `app:`, `blob:`, `data:` and the dev
  server is blocked in `webRequest`.
- Navigation, redirects, new windows and `<webview>` are refused.
- The spellchecker is disabled, because it downloads dictionaries from a
  Google CDN.

The CSP drops the `http://127.0.0.1:*` connect sources and adds
`frame-ancestors 'none'`. A unit test keeps the meta-tag CSP and the
header CSP in sync.

## Decision 4: Treat files and peers as hostile input

This ADR records the following as policy:

- **Network:**
  - The OPDS server checks the `Host` header in loopback mode and requires
    a random access token in LAN mode.
  - Network clients cap response bodies while streaming, enforce one
    deadline covering both headers and body, and do not forward
    credentials across origins.
  - WebDAV does not follow redirects at all.
- **Sync:**
  - Bundles are validated record by record before merging.
  - Folder locks carry an owner token.
  - Tombstones apply only to their own record type, and ones dated in the
    future are ignored.
- **Device transfer:**
  - Destination paths are resolved and confined to the device.
  - Transfers never overwrite a file that appeared after planning.
- **Parsers:**
  - Regular expressions that run on publication content must be linear in
    input size.
  - Every archive read path (loader, quality inspection, repair) goes
    through the EPUB loader's ZIP reader and limits: archive size, entry
    count, per-entry and total decompressed bytes checked before
    decompressing, plus actual-size and CRC verification.
- **Output:** text printed by the CLI is stripped of terminal control
  characters.

## Consequences

- E2E tests stub `dialog.showOpenDialog` in the main process instead of
  typing paths into inputs. Inputs that used to accept typed paths are now
  read-only and filled from dialogs.
- The OPDS server URL in LAN mode changes on every start.
- WebDAV servers that redirect, such as `http`→`https` or a trailing-slash
  redirect, must be configured with their final URL.
- `tests/e2e/security-boundary-desktop.spec.ts` asserts that ungranted
  paths are refused through the real preload bridge.
- `tests/unit/desktop-security-boundary.test.ts`,
  `network-hardening.test.ts` and `sync-device-hardening.test.ts` cover
  the pieces in isolation.
