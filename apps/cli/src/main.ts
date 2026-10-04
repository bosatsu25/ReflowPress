import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  exportBatch,
  exportPublication,
  type ExportFormat,
  type ExportPageSize,
  type ExportWritingMode,
  type BatchExportReport,
} from "@reflowpress/export";
import {
  inspectEpubHealth,
  inspectPdfHealth,
  evaluateQualityGate,
  type QualityProfile,
  type HealthReport,
} from "@reflowpress/quality";
import { planRepairs, executeRepair } from "@reflowpress/repair";
import { OpdsServer, fetchRemoteOpdsFeed } from "@reflowpress/opds";
import {
  FolderSyncAdapter,
  WebdavSyncAdapter,
  mergeSnapshots,
  serializeSyncBundle,
  deserializeSyncBundle,
  createRestorePlan,
  applyRestore,
  type SyncSnapshot,
} from "@reflowpress/sync";
import {
  FilesystemDeviceAdapter,
  type TransferItem,
} from "@reflowpress/device";
import {
  type LibraryCatalog,
  createDefaultCatalog,
} from "@reflowpress/library";

export const CLI_VERSION = "0.1.0";

export const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL_FAILURE: 1,
  FATAL_ERROR: 2,
} as const;

export interface CliOptions {
  readonly format?: ExportFormat | undefined;
  readonly outputDir?: string | undefined;
  readonly pageSize?: ExportPageSize | undefined;
  readonly margin?: string | undefined;
  readonly writingMode?: ExportWritingMode | undefined;
  readonly jobs?: number | undefined;
  readonly overwrite?: boolean | undefined;
  readonly recursive?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly quiet?: boolean | undefined;
}

export interface CliIo {
  stdout?: ((msg: string) => void) | undefined;
  stderr?: ((msg: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export function printHelp(): void {
  const helpText = `
ReflowPress Export Workbench CLI v${CLI_VERSION}

Usage:
  reflowpress [command] [options] <files or directories...>

Commands:
  export                      Export EPUB publications to PDF, HTML, or Markdown (default)
  inspect                     Inspect publication health (EPUB or PDF)
  validate                    Validate PDF outputs against Quality Gate profiles
  repair                      Plan or execute safe repairs on EPUB publications (dry-run by default)
  opds                        Run local OPDS 2.0 catalog server or fetch remote feeds
  sync                        Synchronize library with a target folder or WebDAV endpoint
  backup                      Create a portable sync/backup bundle from library catalog
  restore                     Preview or apply a restore bundle into library catalog
  device                      Detect e-readers, plan transfer, or copy publications

Export Options:
  -f, --format <format>       Output format: pdf | html | markdown | all (default: pdf)
  -o, --output-dir <path>     Target output directory (default: adjacent to input)
  -s, --page-size <size>      PDF page size: A4 | A5 | B5 | Letter (default: A4)
  -m, --margin <margin>       PDF page margin (e.g., "20mm", "1in", "15mm")
  -w, --writing-mode <mode>   Writing mode: auto | horizontal-tb | vertical-rl (default: auto)
  -j, --jobs <n>              Concurrency level for batch exports (default: 4)
      --overwrite             Overwrite existing output files instead of appending -001
  -r, --recursive             Recursively find all .epub files in input directories

Inspect & Validation Options:
      --profile <profile>     PDF validation profile: baseline | reader-export (default: baseline)

Repair Options:
      --apply                 Execute safe repair and write repaired archive (default: preview only)
      --rule <id>             Filter repair actions to specific diagnostic rule ID
      --provenance            Write .provenance.json sidecar metadata

Interoperability Options:
      --port <port>           OPDS server port (default: 3000)
      --host <host>           OPDS server host (default: 127.0.0.1)
      --allow-lan             Allow LAN access to OPDS server (binds to 0.0.0.0)
      --catalog <path>        Path to library catalog JSON file
      --target <path>         Target sync directory or device mount point
      --url <url>             Remote OPDS feed or WebDAV server URL
      --user <username>       WebDAV username (password read via REFLOWPRESS_WEBDAV_PASSWORD)
      --output <path>         Output file path for backup bundle
      --preview               Preview restore operations without modifying catalog
      --policy <policy>       Restore conflict policy: keep-local | keep-remote | keep-both (default: keep-local)
      --dry-run               Simulate sync or device transfer without writing files

Global Options:
      --json                  Print structured JSON report to stdout
  -q, --quiet                 Suppress progress messages (errors still print to stderr)
  -v, --version               Show CLI version
  -h, --help                  Show this help message

Examples:
  reflowpress export book.epub --format pdf
  reflowpress inspect book.epub
  reflowpress validate exported.pdf --profile reader-export
  reflowpress repair book.epub
  reflowpress repair book.epub --apply --output-dir ./repaired
  reflowpress opds serve --port 8080 --catalog ./library.json
  reflowpress sync folder --target /Volumes/SyncFolder --catalog ./library.json
  reflowpress backup --output ./my-backup.json --catalog ./library.json
  reflowpress restore ./my-backup.json --preview
  reflowpress device list --target /Volumes/KOBOeReader
  reflowpress device send /Volumes/KOBOeReader book.epub
`;
  console.log(helpText.trim());
}

async function findFiles(
  targets: readonly string[],
  recursive: boolean,
  extensions: readonly string[],
): Promise<string[]> {
  const matchedPaths: string[] = [];

  for (const target of targets) {
    const resolved = path.resolve(target);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      matchedPaths.push(resolved);
      continue;
    }

    if (stat.isFile()) {
      matchedPaths.push(resolved);
    } else if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved, {
        withFileTypes: true,
        recursive,
      });
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (extensions.some((ext) => lower.endsWith(ext))) {
            const parent =
              (entry as { parentPath?: string }).parentPath ?? resolved;
            matchedPaths.push(path.join(parent, entry.name));
          }
        }
      }
    }
  }

  return [...new Set(matchedPaths)].sort();
}

/**
 * Runs the ReflowPress command-line interface.
 * Returns the process exit code (0, 1, or 2).
 */
export async function runCli(
  args: readonly string[],
  io: CliIo = {},
): Promise<number> {
  const log = io.stdout ?? ((m: string) => console.log(m));
  const logErr = io.stderr ?? ((m: string) => console.error(m));

  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        format: { type: "string", short: "f", default: "pdf" },
        "output-dir": { type: "string", short: "o" },
        "page-size": { type: "string", short: "s", default: "A4" },
        margin: { type: "string", short: "m" },
        "writing-mode": { type: "string", short: "w", default: "auto" },
        jobs: { type: "string", short: "j" },
        overwrite: { type: "boolean", default: false },
        recursive: { type: "boolean", short: "r", default: false },
        profile: { type: "string", default: "baseline" },
        apply: { type: "boolean", default: false },
        rule: { type: "string" },
        provenance: { type: "boolean", default: false },
        port: { type: "string" },
        host: { type: "string" },
        "allow-lan": { type: "boolean", default: false },
        catalog: { type: "string" },
        target: { type: "string" },
        url: { type: "string" },
        user: { type: "string" },
        output: { type: "string" },
        preview: { type: "boolean", default: false },
        policy: { type: "string", default: "keep-local" },
        "dry-run": { type: "boolean", default: false },
        device: { type: "string" },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    logErr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    logErr("Run 'reflowpress --help' for usage instructions.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    printHelp();
    return EXIT_CODES.SUCCESS;
  }

  if (values.version) {
    log(`ReflowPress CLI v${CLI_VERSION}`);
    return EXIT_CODES.SUCCESS;
  }

  const KNOWN_COMMANDS = [
    "export",
    "inspect",
    "validate",
    "repair",
    "opds",
    "sync",
    "backup",
    "restore",
    "device",
  ];

  const firstArg = positionals[0] ?? "";
  const isKnown = KNOWN_COMMANDS.includes(firstArg);
  const command = isKnown ? firstArg : "export";
  const rawInputs = isKnown ? positionals.slice(1) : positionals;

  if (
    ["export", "inspect", "validate", "repair"].includes(command) &&
    rawInputs.length === 0
  ) {
    logErr("Error: No input files or directories specified.");
    logErr("Run 'reflowpress --help' for usage instructions.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const isQuiet = Boolean(values.quiet);
  const isJson = Boolean(values.json);
  const isRecursive = Boolean(values.recursive);

  // Dispatch to subcommand
  if (command === "inspect") {
    return runInspect(rawInputs, { isJson, isQuiet, isRecursive }, log, logErr);
  }

  if (command === "validate") {
    const profile = (
      values.profile === "reader-export" ? "reader-export" : "baseline"
    ) as QualityProfile;
    return runValidate(
      rawInputs,
      { profile, isJson, isQuiet, isRecursive },
      log,
      logErr,
    );
  }

  if (command === "repair") {
    return runRepair(
      rawInputs,
      {
        apply: Boolean(values.apply),
        ruleId: values.rule,
        outputDir: values["output-dir"],
        provenance: Boolean(values.provenance),
        isJson,
        isQuiet,
        isRecursive,
      },
      log,
      logErr,
    );
  }

  if (command === "opds") {
    return runOpds(
      rawInputs,
      values,
      { isJson, isQuiet, signal: io.signal },
      log,
      logErr,
    );
  }

  if (command === "sync") {
    return runSync(rawInputs, values, { isJson, isQuiet }, log, logErr);
  }

  if (command === "backup") {
    return runBackup(rawInputs, values, { isJson, isQuiet }, log, logErr);
  }

  if (command === "restore") {
    return runRestore(rawInputs, values, { isJson, isQuiet }, log, logErr);
  }

  if (command === "device") {
    return runDevice(rawInputs, values, { isJson, isQuiet }, log, logErr);
  }

  // Default: export
  return runExport(
    rawInputs,
    values,
    { isJson, isQuiet, isRecursive, signal: io.signal },
    log,
    logErr,
  );
}

async function loadCatalogFile(catalogPath?: string): Promise<LibraryCatalog> {
  if (!catalogPath) return createDefaultCatalog();
  try {
    const data = await fs.readFile(catalogPath, "utf-8");
    return JSON.parse(data) as LibraryCatalog;
  } catch {
    return createDefaultCatalog();
  }
}

async function saveCatalogFile(
  catalogPath: string,
  catalog: LibraryCatalog,
): Promise<void> {
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
}

function catalogToSnapshot(
  catalog: LibraryCatalog,
  installationId = "cli-node",
): SyncSnapshot {
  const books = (catalog.books || []).map((b) => ({
    id: b.id,
    rev: b.id,
    updatedAt: b.dateAdded || new Date().toISOString(),
    installationId,
    data: {
      portableId: b.id,
      title: b.title,
      author: b.creator,
      format: (b.format === "pdf" ? "pdf" : "epub") as "epub" | "pdf",
      collections: b.collectionIds,
      tags: b.tags,
    },
  }));

  return {
    manifest: {
      schemaVersion: 1,
      bundleId: `bundle-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceInstallationId: installationId,
      counts: {
        books: books.length,
        annotations: 0,
        bookmarks: 0,
        readingPositions: 0,
        tombstones: 0,
        conflicts: 0,
      },
    },
    books,
    annotations: [],
    bookmarks: [],
    readingPositions: [],
    tombstones: [],
    conflicts: [],
  };
}

async function runOpds(
  inputs: readonly string[],
  values: Record<string, unknown>,
  options: {
    isJson: boolean;
    isQuiet: boolean;
    signal?: AbortSignal | undefined;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const subCmd = inputs[0] ?? "serve";
  if (subCmd === "serve") {
    const port = parseInt(String(values.port ?? "3000"), 10);
    const host = String(
      values.host ?? (values["allow-lan"] ? "0.0.0.0" : "127.0.0.1"),
    );
    const allowLan = Boolean(values["allow-lan"]);
    const catalogPath = values.catalog ? String(values.catalog) : undefined;

    const server = new OpdsServer({
      port,
      host,
      allowLan,
      getCatalog: async () => loadCatalogFile(catalogPath),
    });

    try {
      const serverInfo = await server.start();
      if (options.isJson) {
        log(
          JSON.stringify({
            status: "running",
            port: serverInfo.port,
            host: serverInfo.host,
            allowLan: serverInfo.isLan,
            url: serverInfo.url,
          }),
        );
      } else if (!options.isQuiet) {
        log(`ReflowPress OPDS 2.0 Server running at: ${serverInfo.url}`);
        log(`Loopback only: ${!serverInfo.isLan}`);
        log("Press Ctrl+C to stop.");
      }

      if (options.signal) {
        return new Promise<number>((resolve) => {
          options.signal?.addEventListener("abort", async () => {
            await server.stop();
            resolve(EXIT_CODES.SUCCESS);
          });
        });
      }
      return EXIT_CODES.SUCCESS;
    } catch (err) {
      logErr(
        `OPDS server failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  if (subCmd === "fetch") {
    const url = inputs[1] ?? (values.url ? String(values.url) : undefined);
    if (!url) {
      logErr(
        "Error: Missing OPDS feed URL. Usage: reflowpress opds fetch <url>",
      );
      return EXIT_CODES.FATAL_ERROR;
    }

    try {
      const feed = await fetchRemoteOpdsFeed(url);
      if (options.isJson) {
        log(JSON.stringify(feed, null, 2));
      } else if (!options.isQuiet) {
        log(`OPDS Feed: ${feed.metadata.title}`);
        log(`Publications: ${feed.publications?.length ?? 0}`);
        if (feed.publications) {
          for (const pub of feed.publications) {
            log(
              `  - ${pub.metadata.title} (by ${typeof pub.metadata.author === "string" ? pub.metadata.author : "Unknown"})`,
            );
          }
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (err) {
      logErr(
        `OPDS fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  logErr(`Unknown opds subcommand: ${subCmd}. Expected 'serve' or 'fetch'.`);
  return EXIT_CODES.FATAL_ERROR;
}

async function runSync(
  inputs: readonly string[],
  values: Record<string, unknown>,
  options: { isJson: boolean; isQuiet: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const subCmd = inputs[0] ?? "folder";
  const catalogPath = values.catalog ? String(values.catalog) : undefined;
  const catalog = await loadCatalogFile(catalogPath);
  const localSnapshot = catalogToSnapshot(catalog);
  const dryRun = Boolean(values["dry-run"]);

  if (subCmd === "folder") {
    const targetDir =
      (values.target ? String(values.target) : undefined) ?? inputs[1];
    if (!targetDir) {
      logErr("Error: Missing target sync directory. Specify --target <dir>");
      return EXIT_CODES.FATAL_ERROR;
    }

    try {
      const adapter = new FolderSyncAdapter({
        syncFolderPath: path.resolve(targetDir),
      });
      await adapter.acquireLock();
      try {
        const remoteSnapshot = await adapter.readSnapshot();
        const emptyRemoteSnapshot: SyncSnapshot = {
          manifest: {
            schemaVersion: 1,
            bundleId: "remote-folder-init",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sourceInstallationId: "remote-folder",
            counts: {
              books: 0,
              annotations: 0,
              bookmarks: 0,
              readingPositions: 0,
              tombstones: 0,
              conflicts: 0,
            },
          },
          books: [],
          annotations: [],
          bookmarks: [],
          readingPositions: [],
          tombstones: [],
          conflicts: [],
        };

        const mergeResult = mergeSnapshots(
          null,
          localSnapshot,
          remoteSnapshot ?? emptyRemoteSnapshot,
        );

        if (!dryRun) {
          await adapter.writeSnapshot(mergeResult.snapshot);
          if (catalogPath) {
            catalog.updatedAt = new Date().toISOString();
            await saveCatalogFile(catalogPath, catalog);
          }
        }

        if (options.isJson) {
          log(
            JSON.stringify(
              {
                dryRun,
                newConflicts: mergeResult.newConflicts.length,
                mergedBooks: mergeResult.snapshot.books.length,
                appliedRemoteChanges: mergeResult.appliedRemoteChanges,
                preservedLocalChanges: mergeResult.preservedLocalChanges,
              },
              null,
              2,
            ),
          );
        } else if (!options.isQuiet) {
          log(
            `Sync [Folder]: ${path.resolve(targetDir)} ${dryRun ? "(dry-run)" : ""}`,
          );
          log(`Total books in snapshot: ${mergeResult.snapshot.books.length}`);
          log(`Remote changes applied:  ${mergeResult.appliedRemoteChanges}`);
          log(`Conflicts encountered:    ${mergeResult.newConflicts.length}`);
        }
        return EXIT_CODES.SUCCESS;
      } finally {
        await adapter.releaseLock();
      }
    } catch (err) {
      logErr(
        `Sync folder failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  if (subCmd === "webdav") {
    const url = (values.url ? String(values.url) : undefined) ?? inputs[1];
    const username = values.user ? String(values.user) : undefined;
    const password = process.env.REFLOWPRESS_WEBDAV_PASSWORD;

    if (!url) {
      logErr("Error: Missing WebDAV URL. Specify --url <url>");
      return EXIT_CODES.FATAL_ERROR;
    }

    if (!password) {
      logErr(
        "Error: WebDAV password required in environment variable REFLOWPRESS_WEBDAV_PASSWORD (never pass plaintext passwords via CLI flags).",
      );
      return EXIT_CODES.FATAL_ERROR;
    }

    try {
      const adapter = new WebdavSyncAdapter({
        remoteUrl: url,
        username,
        password,
        allowInsecure: false,
      });

      const remoteSnapshot = await adapter.readSnapshot();
      const emptyRemoteSnapshot: SyncSnapshot = {
        manifest: {
          schemaVersion: 1,
          bundleId: "remote-webdav-init",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceInstallationId: "remote-webdav",
          counts: {
            books: 0,
            annotations: 0,
            bookmarks: 0,
            readingPositions: 0,
            tombstones: 0,
            conflicts: 0,
          },
        },
        books: [],
        annotations: [],
        bookmarks: [],
        readingPositions: [],
        tombstones: [],
        conflicts: [],
      };

      const mergeResult = mergeSnapshots(
        null,
        localSnapshot,
        remoteSnapshot ?? emptyRemoteSnapshot,
      );

      if (!dryRun) {
        await adapter.writeSnapshot(mergeResult.snapshot);
        if (catalogPath) {
          catalog.updatedAt = new Date().toISOString();
          await saveCatalogFile(catalogPath, catalog);
        }
      }

      if (options.isJson) {
        log(
          JSON.stringify(
            {
              dryRun,
              newConflicts: mergeResult.newConflicts.length,
              mergedBooks: mergeResult.snapshot.books.length,
              appliedRemoteChanges: mergeResult.appliedRemoteChanges,
              preservedLocalChanges: mergeResult.preservedLocalChanges,
            },
            null,
            2,
          ),
        );
      } else if (!options.isQuiet) {
        log(
          `Sync [WebDAV]: ${adapter.getSanitizedUrl()} ${dryRun ? "(dry-run)" : ""}`,
        );
        log(`Total books in snapshot: ${mergeResult.snapshot.books.length}`);
        log(`Remote changes applied:  ${mergeResult.appliedRemoteChanges}`);
        log(`Conflicts encountered:    ${mergeResult.newConflicts.length}`);
      }
      return EXIT_CODES.SUCCESS;
    } catch (err) {
      logErr(
        `Sync webdav failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  logErr(`Unknown sync target: ${subCmd}. Expected 'folder' or 'webdav'.`);
  return EXIT_CODES.FATAL_ERROR;
}

async function runBackup(
  inputs: readonly string[],
  values: Record<string, unknown>,
  options: { isJson: boolean; isQuiet: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const outputPath = path.resolve(
    String(values.output ?? inputs[0] ?? "./reflowpress-backup.json"),
  );
  const catalogPath = values.catalog ? String(values.catalog) : undefined;
  const catalog = await loadCatalogFile(catalogPath);
  const snapshot = catalogToSnapshot(catalog);

  try {
    const bundleFiles = serializeSyncBundle(snapshot);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify(bundleFiles, null, 2),
      "utf-8",
    );

    if (options.isJson) {
      log(
        JSON.stringify(
          {
            success: true,
            outputPath,
            bookCount: snapshot.books.length,
          },
          null,
          2,
        ),
      );
    } else if (!options.isQuiet) {
      log(
        `Backup bundle saved: ${outputPath} (${snapshot.books.length} publications)`,
      );
    }
    return EXIT_CODES.SUCCESS;
  } catch (err) {
    logErr(
      `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
}

async function runRestore(
  inputs: readonly string[],
  values: Record<string, unknown>,
  options: { isJson: boolean; isQuiet: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const bundlePath = inputs[0];
  if (!bundlePath) {
    logErr(
      "Error: Missing restore bundle path. Usage: reflowpress restore <bundle-file>",
    );
    return EXIT_CODES.FATAL_ERROR;
  }

  try {
    const rawBundle = await fs.readFile(path.resolve(bundlePath), "utf-8");
    const bundleMap = JSON.parse(rawBundle) as Record<string, string>;
    const remoteSnapshot = deserializeSyncBundle(bundleMap);
    const catalogPath = values.catalog ? String(values.catalog) : undefined;
    const catalog = await loadCatalogFile(catalogPath);
    const localSnapshot = catalogToSnapshot(catalog);
    const policy =
      (values.policy as "keep-local" | "keep-remote" | "keep-both") ??
      "keep-local";

    const plan = createRestorePlan(remoteSnapshot, localSnapshot);

    if (values.preview) {
      if (options.isJson) {
        log(JSON.stringify({ preview: true, policy, plan }, null, 2));
      } else if (!options.isQuiet) {
        log(`Restore Preview:`);
        log(
          `  To add:    ${plan.toAdd.books} books, ${plan.toAdd.annotations} annotations`,
        );
        log(
          `  To update: ${plan.toUpdate.books} books, ${plan.toUpdate.annotations} annotations`,
        );
        log(`  Conflicts: ${plan.conflicts.length}`);
      }
      return EXIT_CODES.SUCCESS;
    }

    const { restoredSnapshot, resolvedConflicts } = applyRestore(
      remoteSnapshot,
      localSnapshot,
      { conflictPolicy: policy },
    );

    if (catalogPath) {
      catalog.books = restoredSnapshot.books.map((b) => ({
        id: b.id,
        title: b.data.title,
        creator: b.data.author,
        format: b.data.format,
        collectionIds: b.data.collections ? [...b.data.collections] : [],
        tags: b.data.tags ? [...b.data.tags] : [],
        dateAdded: b.updatedAt,
        filePath: "",
        fileSizeBytes: 0,
        modifiedTimeMs: Date.now(),
        availability: {
          exists: false,
          lastChecked: new Date().toISOString(),
        },
      }));
      catalog.updatedAt = new Date().toISOString();
      await saveCatalogFile(catalogPath, catalog);
    }

    if (options.isJson) {
      log(
        JSON.stringify(
          {
            success: true,
            policy,
            restoredBooks: restoredSnapshot.books.length,
            resolvedConflicts,
          },
          null,
          2,
        ),
      );
    } else if (!options.isQuiet) {
      log(
        `Restore applied successfully (${restoredSnapshot.books.length} publications, ${resolvedConflicts} conflicts resolved).`,
      );
    }
    return EXIT_CODES.SUCCESS;
  } catch (err) {
    logErr(
      `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
}

async function runDevice(
  inputs: readonly string[],
  values: Record<string, unknown>,
  options: { isJson: boolean; isQuiet: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const subCmd = inputs[0] ?? "list";

  if (subCmd === "list") {
    const mountDir = path.resolve(
      String(values.target ?? inputs[1] ?? process.cwd()),
    );
    try {
      const adapter = new FilesystemDeviceAdapter(mountDir);
      const devices = await adapter.discover();
      if (options.isJson) {
        log(JSON.stringify({ mountDir, devices }, null, 2));
      } else if (!options.isQuiet) {
        if (devices.length === 0) {
          log(`No e-reader device detected at: ${mountDir}`);
        } else {
          for (const dev of devices) {
            log(
              `Device detected: ${dev.name} (${dev.profile?.id ?? "generic"})`,
            );
            log(`  Mount point:  ${dev.mountPoint}`);
            log(`  Target dir:   ${dev.profile?.booksDirectory ?? "/"}`);
            log(
              `  Formats:      ${dev.profile?.supportedFormats.join(", ") ?? "epub, pdf"}`,
            );
            if (dev.freeSpaceBytes !== undefined) {
              log(
                `  Free space:   ${(dev.freeSpaceBytes / (1024 * 1024)).toFixed(1)} MB`,
              );
            }
          }
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (err) {
      logErr(
        `Device detection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  if (subCmd === "send") {
    const mountDir = inputs[1];
    const files = inputs.slice(2);
    if (!mountDir || files.length === 0) {
      logErr("Error: Usage: reflowpress device send <device-mount> <files...>");
      return EXIT_CODES.FATAL_ERROR;
    }

    try {
      const adapter = new FilesystemDeviceAdapter(path.resolve(mountDir));
      const devices = await adapter.discover();
      const dev = devices[0];
      if (!dev) {
        logErr(`Error: No valid device found at mount path '${mountDir}'`);
        return EXIT_CODES.FATAL_ERROR;
      }

      const items: TransferItem[] = [];
      for (const f of files) {
        const resolved = path.resolve(f);
        const st = await fs.stat(resolved);
        const ext = path.extname(resolved).toLowerCase().replace(".", "");
        items.push({
          sourcePath: resolved,
          targetFilename: path.basename(resolved),
          format: ext === "pdf" ? "pdf" : "epub",
          byteSize: st.size,
        });
      }

      const plan = await adapter.createTransferPlan(items, dev);

      if (values["dry-run"]) {
        if (options.isJson) {
          log(JSON.stringify({ dryRun: true, plan }, null, 2));
        } else if (!options.isQuiet) {
          log(
            `Transfer plan (dry-run): ${plan.items.length} items to ${dev.name}`,
          );
          for (const it of plan.items) {
            log(
              `  - ${path.basename(it.sourcePath)} -> ${it.targetPath} [${it.status}]`,
            );
          }
        }
        return EXIT_CODES.SUCCESS;
      }

      const result = await adapter.executeTransfer(plan);

      if (options.isJson) {
        log(JSON.stringify(result, null, 2));
      } else if (!options.isQuiet) {
        log(
          `Transferred: ${result.successful}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
        );
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            logErr(`  Error: ${err.path}: ${err.error}`);
          }
        }
      }
      return result.failed === 0
        ? EXIT_CODES.SUCCESS
        : EXIT_CODES.PARTIAL_FAILURE;
    } catch (err) {
      logErr(
        `Device transfer failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  logErr(`Unknown device subcommand: ${subCmd}. Expected 'list' or 'send'.`);
  return EXIT_CODES.FATAL_ERROR;
}

async function runInspect(
  inputs: readonly string[],
  options: { isJson: boolean; isQuiet: boolean; isRecursive: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".epub", ".pdf"]);
  if (files.length === 0) {
    logErr(
      `Error: No .epub or .pdf files found matching inputs: ${inputs.join(", ")}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }

  const reports: HealthReport[] = [];
  let hasFatalOrError = false;
  let hasWarning = false;

  for (const file of files) {
    let report: HealthReport;
    if (file.toLowerCase().endsWith(".pdf")) {
      try {
        const bytes = await fs.readFile(file);
        report = inspectPdfHealth(bytes, file);
      } catch (err) {
        logErr(
          `Failed to read PDF '${file}': ${err instanceof Error ? err.message : String(err)}`,
        );
        hasFatalOrError = true;
        continue;
      }
    } else {
      report = await inspectEpubHealth(file);
    }

    reports.push(report);
    if (report.summary.fatalCount > 0 || report.summary.errorCount > 0) {
      hasFatalOrError = true;
    }
    if (report.summary.warningCount > 0) {
      hasWarning = true;
    }
  }

  if (options.isJson) {
    log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else if (!options.isQuiet) {
    for (const report of reports) {
      log(
        `\n=== Publication Health Report: ${path.basename(report.publicationPath)} ===`,
      );
      log(
        `Type: ${report.publicationType.toUpperCase()} | Duration: ${report.durationMs}ms`,
      );
      log(
        `Findings: ${report.summary.totalFindings} (Fatal: ${report.summary.fatalCount}, Error: ${report.summary.errorCount}, Warning: ${report.summary.warningCount}, Info: ${report.summary.infoCount})`,
      );
      log(
        `Repairable: ${report.summary.safeRepairableCount} safe-auto, ${report.summary.reviewRequiredCount} review-required, ${report.summary.manualCount} manual`,
      );

      if (report.mediaOverlays?.hasMediaOverlays) {
        log(
          `Media Overlays: ${report.mediaOverlays.documentCount} document(s), duration: ${report.mediaOverlays.totalDurationSeconds.toFixed(1)}s, missing audio: ${report.mediaOverlays.missingAudioFiles.length}`,
        );
      }

      if (report.findings.length > 0) {
        log("\nDiagnostics:");
        for (const f of report.findings) {
          const loc = f.location?.path
            ? ` [${f.location.path}${f.location.line ? `:${f.location.line}` : ""}]`
            : "";
          log(
            `  [${f.severity.toUpperCase()}] ${f.ruleId}${loc}: ${f.message}`,
          );
        }
      } else {
        log("\n✓ No quality issues found. Publication is healthy.");
      }
    }
  }

  if (hasFatalOrError) return EXIT_CODES.FATAL_ERROR;
  if (hasWarning) return EXIT_CODES.PARTIAL_FAILURE;
  return EXIT_CODES.SUCCESS;
}

async function runValidate(
  inputs: readonly string[],
  options: {
    profile: QualityProfile;
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".pdf"]);
  if (files.length === 0) {
    logErr(`Error: No .pdf files found matching inputs: ${inputs.join(", ")}`);
    return EXIT_CODES.FATAL_ERROR;
  }

  const results = [];
  let allPassed = true;

  for (const file of files) {
    try {
      const bytes = await fs.readFile(file);
      const report = inspectPdfHealth(bytes, file);
      const gateResult = evaluateQualityGate(report, options.profile);
      results.push(gateResult);
      if (!gateResult.passed) {
        allPassed = false;
      }
    } catch (err) {
      logErr(
        `Failed to read PDF '${file}': ${err instanceof Error ? err.message : String(err)}`,
      );
      allPassed = false;
    }
  }

  if (options.isJson) {
    log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else if (!options.isQuiet) {
    for (const res of results) {
      const statusStr = res.passed ? "PASS" : "FAIL";
      log(
        `[${statusStr}] ${path.basename(res.report.publicationPath)} (profile: ${res.profile})`,
      );
      if (!res.passed) {
        for (const v of res.violations) {
          log(`  - [${v.severity.toUpperCase()}] ${v.ruleId}: ${v.message}`);
        }
      }
    }
  }

  return allPassed ? EXIT_CODES.SUCCESS : EXIT_CODES.FATAL_ERROR;
}

async function runRepair(
  inputs: readonly string[],
  options: {
    apply: boolean;
    ruleId?: string | undefined;
    outputDir?: string | undefined;
    provenance: boolean;
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".epub"]);
  if (files.length === 0) {
    logErr(`Error: No .epub files found matching inputs: ${inputs.join(", ")}`);
    return EXIT_CODES.FATAL_ERROR;
  }

  const results = [];
  let hasFailure = false;

  for (const file of files) {
    const report = await inspectEpubHealth(file);
    const { plan, preview } = planRepairs(report, {
      specificRuleIds: options.ruleId ? [options.ruleId] : undefined,
    });

    if (!options.apply) {
      // Dry-run preview
      results.push({ publication: file, plan, preview, mode: "dry-run" });
      if (!options.isJson && !options.isQuiet) {
        log(`\n=== Repair Preview (Dry Run): ${path.basename(file)} ===`);
        log(
          `Planned actions: ${plan.actions.length} (${plan.safeActionCount} safe-auto)`,
        );
        if (plan.actions.length === 0) {
          log("No repairable issues detected.");
        } else {
          for (const action of plan.actions) {
            log(
              `  - [${action.risk.toUpperCase()}] ${action.title} (${action.targetFile})`,
            );
          }
          log(
            "\nRun with '--apply' to execute these repairs non-destructively.",
          );
        }
      }
    } else {
      // Execute repair
      if (plan.actions.length === 0) {
        results.push({
          publication: file,
          success: true,
          message: "No repairs needed",
        });
        if (!options.isQuiet && !options.isJson) {
          log(`\n${path.basename(file)}: No repairable issues found.`);
        }
        continue;
      }

      const repairResult = await executeRepair(file, plan, {
        outputDir: options.outputDir
          ? path.resolve(options.outputDir)
          : undefined,
        writeProvenance: options.provenance,
      });

      results.push(repairResult);
      if (!repairResult.success) {
        hasFailure = true;
        if (!options.isQuiet && !options.isJson) {
          logErr(
            `\nRepair failed for ${path.basename(file)}: ${repairResult.error}`,
          );
        }
      } else if (!options.isQuiet && !options.isJson) {
        log(`\n✓ Repaired publication created: ${repairResult.outputPath}`);
        log(
          `  Applied ${repairResult.actionsApplied.length} action(s). Verified clean with 0 regressions.`,
        );
      }
    }
  }

  if (options.isJson) {
    log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }

  return hasFailure ? EXIT_CODES.FATAL_ERROR : EXIT_CODES.SUCCESS;
}

interface ExportCliValues {
  readonly format?: string | undefined;
  readonly "page-size"?: string | undefined;
  readonly "writing-mode"?: string | undefined;
  readonly "output-dir"?: string | undefined;
  readonly margin?: string | undefined;
  readonly jobs?: string | undefined;
  readonly overwrite?: boolean | undefined;
}

async function runExport(
  rawInputs: readonly string[],
  values: ExportCliValues,
  options: {
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
    signal?: AbortSignal | undefined;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  // Validate format
  const formatStr = values.format?.toLowerCase() || "pdf";
  if (!["pdf", "html", "markdown", "all"].includes(formatStr)) {
    logErr(
      `Error: Invalid format '${formatStr}'. Must be one of: pdf, html, markdown, all.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const format = formatStr as ExportFormat;

  // Validate page-size
  const pageSizeStr = values["page-size"] || "A4";
  if (!["A4", "A5", "B5", "Letter"].includes(pageSizeStr)) {
    logErr(
      `Error: Invalid page size '${pageSizeStr}'. Must be one of: A4, A5, B5, Letter.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const pageSize = pageSizeStr as ExportPageSize;

  // Validate writing-mode
  const writingModeStr = values["writing-mode"] || "auto";
  if (!["auto", "horizontal-tb", "vertical-rl"].includes(writingModeStr)) {
    logErr(
      `Error: Invalid writing mode '${writingModeStr}'. Must be one of: auto, horizontal-tb, vertical-rl.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const writingMode = writingModeStr as ExportWritingMode;

  const jobs = values.jobs ? parseInt(values.jobs, 10) : undefined;
  if (jobs !== undefined && (isNaN(jobs) || jobs < 1)) {
    logErr("Error: --jobs must be a positive integer.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const epubFiles = await findFiles(rawInputs, options.isRecursive, [".epub"]);
  if (epubFiles.length === 0) {
    logErr(
      `Error: No .epub files found matching input targets: ${rawInputs.join(", ")}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }

  const exportOpts = {
    format,
    ...(values["output-dir"]
      ? { outputDir: path.resolve(values["output-dir"]) }
      : {}),
    pageSize,
    ...(values.margin ? { margin: values.margin } : {}),
    writingMode,
    overwrite: Boolean(values.overwrite),
  };

  if (
    epubFiles.length === 1 &&
    rawInputs.length === 1 &&
    !options.isRecursive
  ) {
    const singleFile = epubFiles[0]!;
    if (!options.isQuiet && !options.isJson) {
      log(
        `Exporting publication: ${path.basename(singleFile)} [format: ${format}]...`,
      );
    }

    try {
      const results = await exportPublication(singleFile, exportOpts);
      if (options.isJson) {
        log(
          JSON.stringify(
            { success: true, count: results.length, results },
            null,
            2,
          ),
        );
      } else if (!options.isQuiet) {
        for (const res of results) {
          log(
            `Exported [${res.format.toUpperCase()}]: ${res.outputPath} (${(res.byteSize / 1024).toFixed(1)} KB) in ${res.durationMs}ms`,
          );
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (error) {
      if (options.isJson) {
        log(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        );
      } else {
        logErr(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  if (!options.isQuiet && !options.isJson) {
    log(
      `Starting batch export of ${epubFiles.length} publication(s) [format: ${format}]...`,
    );
  }

  const report: BatchExportReport = await exportBatch(epubFiles, {
    ...exportOpts,
    jobs,
    signal: options.signal,
    onProgress: (done, total, file) => {
      if (!options.isQuiet && !options.isJson) {
        log(`[${done}/${total}] Processed ${path.basename(file)}`);
      }
    },
  });

  if (options.isJson) {
    log(JSON.stringify(report, null, 2));
  } else if (!options.isQuiet) {
    log("\n--- Batch Export Summary ---");
    log(`Total files:      ${report.totalFiles}`);
    log(`Successful:       ${report.successfulFiles}`);
    log(`Failed:           ${report.failedFiles}`);
    log(`Outputs produced: ${report.totalOutputs}`);
    log(`Total size:       ${(report.totalByteSize / 1024).toFixed(1)} KB`);
    log(`Duration:         ${report.durationMs}ms`);
    if (report.failedFiles > 0) {
      log("\nFailed files:");
      for (const item of report.items) {
        if (!item.success) {
          log(
            `  - ${path.basename(item.inputPath)}: [${item.errorCode}] ${item.error}`,
          );
        }
      }
    }
  }

  if (report.failedFiles === 0) return EXIT_CODES.SUCCESS;
  if (report.successfulFiles > 0) return EXIT_CODES.PARTIAL_FAILURE;
  return EXIT_CODES.FATAL_ERROR;
}
