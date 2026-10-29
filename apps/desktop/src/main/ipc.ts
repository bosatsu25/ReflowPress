import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadEpub } from "@reflowpress/epub";
import { inspectEpubHealth, inspectPdfHealth } from "@reflowpress/quality";
import { planRepairs, executeRepair } from "@reflowpress/repair";
import { OpdsServer } from "@reflowpress/opds";
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
import type { LoadedPublicationResult } from "../preload/types.js";
import type { SavedReadingPosition } from "@reflowpress/reader";
import {
  type LibraryCatalog,
  type ScanResult,
  removeBookFromCatalog,
  updateBookInCatalog,
  createCollection,
  deleteCollection,
  addBookToCollection,
  removeBookFromCollection,
} from "@reflowpress/library";
import type {
  AnnotationStore,
  PublicationIdentity,
  ImportReport,
} from "@reflowpress/annotations";
import {
  showOpenFileNativeDialog,
  showOpenMultipleFilesNativeDialog,
  showOpenDirectoryNativeDialog,
  showSaveFileDialog,
  showOpenAnnotationFileDialog,
  showOpenBackupFileDialog,
  type DirectoryPurpose,
} from "./file-dialog.js";
import type { ReadingPositionStore } from "./reading-position-store.js";
import type { JsonLibraryRepository } from "./library-repository.js";
import type { JsonAnnotationRepository } from "./annotation-repository.js";
import { scanLibraryPaths } from "./library-scanner.js";
import type { CrashRecoveryManager } from "./crash-recovery.js";
import {
  PathGrantRegistry,
  PathAccessDeniedError,
  samePath,
} from "./security/path-grants.js";
import { isTrustedSender, UntrustedSenderError } from "./security/ipc-guard.js";
import {
  pickEditableBookFields,
  syncRecordsToCatalogBooks,
} from "./sync-catalog.js";

/** Backup bundles above this size are refused before parsing. */
const MAX_BACKUP_BUNDLE_BYTES = 32 * 1024 * 1024;

export interface IpcSecurityOptions {
  readonly pathGrants: PathGrantRegistry;
  readonly isRendererUrl: (url: string) => boolean;
}

export function registerIpcHandlers(
  window: BrowserWindow,
  positionStore: ReadingPositionStore,
  libraryRepo: JsonLibraryRepository,
  annotationRepo: JsonAnnotationRepository,
  coversDir: string,
  initialFilePath: string | null = null,
  crashRecovery?: CrashRecoveryManager,
  security: IpcSecurityOptions = {
    pathGrants: new PathGrantRegistry(),
    isRendererUrl: () => false,
  },
): void {
  const { pathGrants } = security;
  const webContentsId = window.webContents.id;

  // Every privileged channel is registered through this wrapper, so a call
  // from the book iframe or any other frame is refused before the handler
  // runs.
  function handle<A extends unknown[], R>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>,
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event, webContentsId, security.isRendererUrl)) {
        throw new UntrustedSenderError(channel);
      }
      return handler(event, ...(args as A));
    });
  }

  async function isLibraryBookPath(filePath: string): Promise<boolean> {
    const catalog = await libraryRepo.load();
    return catalog.books.some(
      (book) => book.filePath !== "" && samePath(book.filePath, filePath),
    );
  }

  /** Publications are readable when the user picked them or they are in the library. */
  async function requireReadablePublication(
    filePath: unknown,
    purpose: string,
  ): Promise<string> {
    if (typeof filePath === "string" && filePath.length > 0) {
      if (pathGrants.isGranted(filePath, "read")) {
        return path.resolve(filePath);
      }
      if (await isLibraryBookPath(filePath)) {
        return path.resolve(filePath);
      }
    }
    throw new PathAccessDeniedError(purpose);
  }

  async function confirm(message: string, detail: string): Promise<boolean> {
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Cancel", "Allow"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message,
      detail,
    });
    return response === 1;
  }

  handle("app:get-crash-recovery-status", async () => {
    return crashRecovery?.getRecoveryStatus() ?? null;
  });

  handle("app:clear-crash-recovery-status", async () => {
    crashRecovery?.clearRecoveryStatus();
    return true;
  });

  handle("app:get-initial-file", async () => {
    return initialFilePath;
  });

  // Dialog results are the only way the renderer obtains a usable path.
  handle("dialog:open-file", async () => {
    const selected = await showOpenFileNativeDialog(window);
    if (selected) pathGrants.grantFile(selected, ["read"]);
    return selected;
  });

  handle("dialog:open-multiple-files", async () => {
    const selected = await showOpenMultipleFilesNativeDialog(window);
    for (const file of selected) pathGrants.grantFile(file, ["read"]);
    return selected;
  });

  handle("dialog:open-directory", async (_event, purpose?: unknown) => {
    const directoryPurpose: DirectoryPurpose =
      purpose === "sync" || purpose === "device" ? purpose : "library";
    const selected = await showOpenDirectoryNativeDialog(
      window,
      directoryPurpose,
    );
    if (selected) {
      // Library folders are only scanned; sync and device folders are
      // written to.
      pathGrants.grantDirectory(
        selected,
        directoryPurpose === "library" ? ["read"] : ["read", "write"],
      );
    }
    return selected;
  });

  handle(
    "publication:load",
    async (_event, filePath: unknown): Promise<LoadedPublicationResult> => {
      const normalizedAbsPath = await requireReadablePublication(
        filePath,
        "Opening a publication",
      );
      const ext = path.extname(normalizedAbsPath).toLowerCase();

      if (ext === ".epub") {
        const pub = await loadEpub(normalizedAbsPath);
        const publicationId =
          pub.metadata.identifier || `path:${normalizedAbsPath}`;
        const title = pub.metadata.title || path.basename(normalizedAbsPath);

        const result: LoadedPublicationResult = {
          kind: "epub",
          path: normalizedAbsPath,
          publicationId,
          publication: pub,
          title,
        };

        if (crashRecovery) {
          await crashRecovery.updateActiveSession({
            lastActivePublication: {
              id: publicationId,
              filePath: normalizedAbsPath,
              title,
            },
            lastView: "reader",
          });
        }

        return result;
      }

      if (ext === ".pdf") {
        const publicationId = `path:${normalizedAbsPath}`;
        const title = path.basename(normalizedAbsPath, ".pdf");

        const result: LoadedPublicationResult = {
          kind: "pdf",
          path: normalizedAbsPath,
          publicationId,
          title,
        };

        if (crashRecovery) {
          await crashRecovery.updateActiveSession({
            lastActivePublication: {
              id: publicationId,
              filePath: normalizedAbsPath,
              title,
            },
            lastView: "reader",
          });
        }

        return result;
      }

      throw new Error(`Unsupported publication format: ${ext}`);
    },
  );

  handle("publication:read-pdf", async (_event, filePath: unknown) => {
    const resolvedPath = await requireReadablePublication(
      filePath,
      "Reading a PDF",
    );
    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext !== ".pdf") {
      throw new Error(
        `Security violation: expected a .pdf file, received '${ext}'`,
      );
    }
    return readFile(resolvedPath);
  });

  handle("position:get", async (_event, publicationId: string) => {
    return positionStore.getPosition(publicationId);
  });

  handle("position:set", async (_event, position: SavedReadingPosition) => {
    await positionStore.savePosition(position);
    if (crashRecovery) {
      await crashRecovery.updateActiveSession({
        lastUpdatedAt: new Date().toISOString(),
      });
    }
  });

  // Library Handlers
  handle("library:load", async () => {
    const catalog = await libraryRepo.load();
    const verified = await libraryRepo.verifyAvailability(catalog);
    return verified;
  });

  handle(
    "library:scan-paths",
    async (
      _event,
      pathsToScan: unknown,
    ): Promise<{ catalog: LibraryCatalog; result: ScanResult }> => {
      if (!Array.isArray(pathsToScan)) {
        throw new PathAccessDeniedError("Scanning the library");
      }
      const allowed = pathsToScan.map((target) =>
        pathGrants.require(target, "read", "Scanning the library"),
      );
      const currentCatalog = await libraryRepo.load();
      const { catalog: updatedCatalog, result } = await scanLibraryPaths(
        allowed,
        currentCatalog,
        coversDir,
      );
      await libraryRepo.save(updatedCatalog);
      return { catalog: updatedCatalog, result };
    },
  );

  handle("library:remove-book", async (_event, bookId: string) => {
    const catalog = await libraryRepo.load();
    const updated = removeBookFromCatalog(catalog, bookId);
    await libraryRepo.save(updated);
    return updated;
  });

  handle(
    "library:update-book",
    async (
      _event,
      bookId: string,
      updates: unknown,
    ): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      // File locations, identity and availability are owned by the main
      // process; the renderer may only touch user-facing metadata.
      const updated = updateBookInCatalog(
        catalog,
        bookId,
        pickEditableBookFields(updates),
      );
      await libraryRepo.save(updated);
      return updated;
    },
  );

  handle(
    "library:create-collection",
    async (
      _event,
      name: string,
      description?: string,
    ): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const { catalog: updated } = createCollection(catalog, name, description);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  handle(
    "library:delete-collection",
    async (_event, collectionId: string): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const updated = deleteCollection(catalog, collectionId);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  handle(
    "library:add-book-to-collection",
    async (
      _event,
      bookId: string,
      collectionId: string,
    ): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const updated = addBookToCollection(catalog, bookId, collectionId);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  handle(
    "library:remove-book-from-collection",
    async (
      _event,
      bookId: string,
      collectionId: string,
    ): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const updated = removeBookFromCollection(catalog, bookId, collectionId);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  const coverReader = new PathGrantRegistry();
  coverReader.grantDirectory(coversDir, ["read"]);

  handle(
    "library:read-cover",
    async (_event, coverPath: unknown): Promise<string | null> => {
      try {
        // Covers are only ever read from the app's own cover cache.
        const resolvedPath = coverReader.require(
          coverPath,
          "read",
          "Reading a cover image",
        );
        const ext = path.extname(resolvedPath).toLowerCase();
        const validImageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
        if (!validImageExts.includes(ext)) {
          return null;
        }
        const buffer = await readFile(resolvedPath);
        const mimeType =
          ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : "image/png";
        return `data:${mimeType};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  handle("annotations:load", async (): Promise<AnnotationStore> => {
    return annotationRepo.load();
  });

  handle(
    "annotations:save",
    async (_event, store: AnnotationStore): Promise<void> => {
      await annotationRepo.save(store);
    },
  );

  handle(
    "annotations:export",
    async (
      _event,
      publication: PublicationIdentity,
      format: unknown,
      targetPath: unknown,
      publicationId?: string,
    ): Promise<void> => {
      if (format !== "json" && format !== "markdown" && format !== "html") {
        throw new Error(
          `Unsupported annotation export format: ${String(format)}`,
        );
      }
      const allowedTarget = pathGrants.require(
        targetPath,
        "write",
        "Exporting annotations",
      );
      await annotationRepo.exportToFile(
        publication,
        format,
        allowedTarget,
        publicationId,
      );
    },
  );

  handle(
    "annotations:import",
    async (
      _event,
      sourcePath: unknown,
      targetPublicationId: string,
    ): Promise<ImportReport> => {
      const allowedSource = pathGrants.require(
        sourcePath,
        "read",
        "Importing annotations",
      );
      return annotationRepo.importFromFile(allowedSource, targetPublicationId);
    },
  );

  handle(
    "dialog:save-file",
    async (
      _event,
      options: {
        title: string;
        defaultPath?: string;
        filters: Array<{ name: string; extensions: string[] }>;
      },
    ): Promise<string | null> => {
      const selected = await showSaveFileDialog(window, options);
      if (selected) pathGrants.grantFile(selected, ["write"]);
      return selected;
    },
  );

  handle("dialog:open-annotation-file", async (): Promise<string | null> => {
    const selected = await showOpenAnnotationFileDialog(window);
    if (selected) pathGrants.grantFile(selected, ["read"]);
    return selected;
  });

  handle("dialog:open-backup-file", async (): Promise<string | null> => {
    const selected = await showOpenBackupFileDialog(window);
    if (selected) pathGrants.grantFile(selected, ["read"]);
    return selected;
  });

  handle("publication:inspect", async (_event, filePath: unknown) => {
    const allowedPath = await requireReadablePublication(
      filePath,
      "Inspecting a publication",
    );
    if (allowedPath.toLowerCase().endsWith(".pdf")) {
      const bytes = await readFile(allowedPath);
      return inspectPdfHealth(bytes, allowedPath);
    }
    return inspectEpubHealth(allowedPath);
  });

  handle(
    "publication:repair",
    async (
      _event,
      filePath: unknown,
      options?: { apply?: boolean; ruleId?: string; outputDir?: string },
    ) => {
      const allowedPath = await requireReadablePublication(
        filePath,
        "Repairing a publication",
      );
      const report = await inspectEpubHealth(allowedPath);
      const { plan, preview } = planRepairs(report, {
        specificRuleIds: options?.ruleId ? [options.ruleId] : undefined,
      });

      if (!options?.apply) {
        return { plan, preview };
      }

      // Without an explicit output directory the repair engine writes a new
      // file next to the source; any other location must be user-chosen.
      const outputDir =
        options.outputDir === undefined
          ? undefined
          : pathGrants.require(
              options.outputDir,
              "write",
              "Writing a repaired publication",
            );

      return executeRepair(allowedPath, plan, {
        outputDir,
        writeProvenance: true,
      });
    },
  );

  let activeOpdsServer: OpdsServer | null = null;
  let activeOpdsInfo: { url: string; port: number; isLan: boolean } | null =
    null;

  window.on("closed", () => {
    if (activeOpdsServer) {
      activeOpdsServer.stop().catch(() => {});
      activeOpdsServer = null;
      activeOpdsInfo = null;
    }
  });

  // OPDS Handlers
  handle(
    "opds:start",
    async (_event, options?: { port?: unknown; allowLan?: unknown }) => {
      const port = options?.port ?? 3000;
      if (
        typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1024 ||
        port > 65535
      ) {
        throw new Error("OPDS port must be an integer between 1024 and 65535.");
      }
      const allowLan = options?.allowLan === true;
      if (
        allowLan &&
        !(await confirm(
          "Share your library on the local network?",
          "Any device on this network will be able to browse and download " +
            "the books in your ReflowPress library until the server is " +
            "stopped.",
        ))
      ) {
        throw new Error("LAN sharing was not allowed.");
      }

      if (activeOpdsServer) {
        await activeOpdsServer.stop();
      }
      activeOpdsServer = new OpdsServer({
        port,
        allowLan,
        // On the network the catalog URL itself is the credential.
        accessToken: allowLan
          ? randomBytes(24).toString("base64url")
          : undefined,
        getCatalog: () => libraryRepo.load(),
      });
      activeOpdsInfo = await activeOpdsServer.start();
      return activeOpdsInfo;
    },
  );

  handle("opds:stop", async () => {
    if (activeOpdsServer) {
      await activeOpdsServer.stop();
      activeOpdsServer = null;
      activeOpdsInfo = null;
    }
  });

  handle("opds:status", async () => {
    return {
      running: Boolean(activeOpdsServer),
      url: activeOpdsInfo?.url,
      port: activeOpdsInfo?.port,
      isLan: activeOpdsInfo?.isLan,
    };
  });

  // Sync Handlers
  handle(
    "sync:folder",
    async (_event, targetDir: unknown, options?: { dryRun?: boolean }) => {
      const syncFolderPath = pathGrants.require(
        targetDir,
        "write",
        "Syncing to a folder",
      );
      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);
      const adapter = new FolderSyncAdapter({ syncFolderPath });

      await adapter.acquireLock();
      try {
        const remoteSnapshot = await adapter.readSnapshot();
        const mergeResult = mergeSnapshots(
          null,
          localSnapshot,
          remoteSnapshot ?? emptySnapshot("remote-folder"),
        );

        if (!options?.dryRun) {
          await adapter.writeSnapshot(mergeResult.snapshot);
          catalog.books = syncRecordsToCatalogBooks(
            mergeResult.snapshot.books,
            catalog.books,
          );
          await libraryRepo.save(catalog);
        }

        return {
          appliedRemote: mergeResult.appliedRemoteChanges,
          preservedLocal: mergeResult.preservedLocalChanges,
          conflicts: mergeResult.newConflicts.length,
          totalBooks: mergeResult.snapshot.books.length,
        };
      } finally {
        await adapter.releaseLock();
      }
    },
  );

  // Hosts the user has agreed to send library metadata to in this session.
  const approvedWebdavHosts = new Set<string>();

  handle(
    "sync:webdav",
    async (
      _event,
      url: unknown,
      username?: string,
      password?: string,
      options?: { dryRun?: boolean },
    ) => {
      if (typeof url !== "string") {
        throw new Error("WebDAV URL must be a string.");
      }
      let remote: URL;
      try {
        remote = new URL(url);
      } catch {
        throw new Error("WebDAV URL is not a valid URL.");
      }
      if (remote.protocol !== "https:") {
        throw new Error("WebDAV sync requires an https:// URL.");
      }
      if (
        !approvedWebdavHosts.has(remote.host) &&
        !(await confirm(
          `Sync your library with ${remote.host}?`,
          "ReflowPress will upload your library catalog (titles, authors, " +
            `tags and collections) to ${remote.origin}.`,
        ))
      ) {
        throw new Error("WebDAV sync was not allowed.");
      }
      approvedWebdavHosts.add(remote.host);

      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);
      const adapter = new WebdavSyncAdapter({
        remoteUrl: remote.toString(),
        username,
        password,
        allowInsecure: false,
      });

      const remoteSnapshot = await adapter.readSnapshot();
      const mergeResult = mergeSnapshots(
        null,
        localSnapshot,
        remoteSnapshot ?? emptySnapshot("remote-webdav"),
      );

      if (!options?.dryRun) {
        await adapter.writeSnapshot(mergeResult.snapshot);
        catalog.books = syncRecordsToCatalogBooks(
          mergeResult.snapshot.books,
          catalog.books,
        );
        await libraryRepo.save(catalog);
      }

      return {
        appliedRemote: mergeResult.appliedRemoteChanges,
        preservedLocal: mergeResult.preservedLocalChanges,
        conflicts: mergeResult.newConflicts.length,
        totalBooks: mergeResult.snapshot.books.length,
      };
    },
  );

  // Backup & Restore Handlers
  handle("backup:create", async (_event, outputPath: unknown) => {
    const allowedOutput = pathGrants.require(
      outputPath,
      "write",
      "Creating a backup",
    );
    const catalog = await libraryRepo.load();
    const snapshot = catalogToSnapshot(catalog);
    const bundleFiles = serializeSyncBundle(snapshot);
    await writeFile(
      allowedOutput,
      JSON.stringify(bundleFiles, null, 2),
      "utf-8",
    );
    return {
      success: true,
      outputPath: allowedOutput,
      count: snapshot.books.length,
    };
  });

  async function readBackupBundle(bundlePath: unknown): Promise<SyncSnapshot> {
    const allowedBundle = pathGrants.require(
      bundlePath,
      "read",
      "Restoring a backup",
    );
    const { size } = await stat(allowedBundle);
    if (size > MAX_BACKUP_BUNDLE_BYTES) {
      throw new Error(
        `Backup bundle is too large (${size} bytes; limit ${MAX_BACKUP_BUNDLE_BYTES}).`,
      );
    }
    const raw = await readFile(allowedBundle, "utf-8");
    const bundleMap = JSON.parse(raw) as Record<string, string>;
    return deserializeSyncBundle(bundleMap);
  }

  handle("restore:preview", async (_event, bundlePath: unknown) => {
    const remoteSnapshot = await readBackupBundle(bundlePath);
    const catalog = await libraryRepo.load();
    const localSnapshot = catalogToSnapshot(catalog);
    return createRestorePlan(remoteSnapshot, localSnapshot);
  });

  handle(
    "restore:apply",
    async (
      _event,
      bundlePath: unknown,
      policy?: "keep-local" | "keep-remote" | "keep-both",
    ) => {
      const remoteSnapshot = await readBackupBundle(bundlePath);
      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);

      const { restoredSnapshot, resolvedConflicts } = applyRestore(
        remoteSnapshot,
        localSnapshot,
        { conflictPolicy: policy ?? "keep-local" },
      );

      catalog.books = syncRecordsToCatalogBooks(
        restoredSnapshot.books,
        catalog.books,
      );
      catalog.updatedAt = new Date().toISOString();
      await libraryRepo.save(catalog);

      return {
        restoredBooks: restoredSnapshot.books.length,
        resolvedConflicts,
      };
    },
  );

  // Device Handlers
  handle("device:discover", async (_event, targetDir: unknown) => {
    const mountDir = pathGrants.require(
      targetDir,
      "read",
      "Detecting a device",
    );
    const adapter = new FilesystemDeviceAdapter(mountDir);
    return adapter.discover();
  });

  handle(
    "device:transfer",
    async (_event, targetMount: unknown, bookIds: unknown) => {
      const mountDir = pathGrants.require(
        targetMount,
        "write",
        "Transferring to a device",
      );
      const requestedIds = Array.isArray(bookIds)
        ? bookIds.filter((id): id is string => typeof id === "string")
        : [];
      const catalog = await libraryRepo.load();
      const booksToTransfer = catalog.books.filter((b) =>
        requestedIds.includes(b.id),
      );

      const adapter = new FilesystemDeviceAdapter(mountDir);
      const devices = await adapter.discover();
      const dev = devices[0];
      if (!dev) {
        throw new Error(
          `No valid target e-reader device found at '${mountDir}'`,
        );
      }

      const items: TransferItem[] = [];
      for (const b of booksToTransfer) {
        if (!b.filePath) continue;
        try {
          const st = await stat(b.filePath);
          items.push({
            sourcePath: b.filePath,
            targetFilename: path.basename(b.filePath),
            format: b.format,
            byteSize: st.size,
          });
        } catch {
          // File missing or inaccessible, skip
        }
      }

      const plan = await adapter.createTransferPlan(items, dev);
      return adapter.executeTransfer(plan);
    },
  );
}

function emptySnapshot(installationId: string): SyncSnapshot {
  const now = new Date().toISOString();
  return {
    manifest: {
      schemaVersion: 1,
      bundleId: `${installationId}-init`,
      createdAt: now,
      updatedAt: now,
      sourceInstallationId: installationId,
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
}

function catalogToSnapshot(
  catalog: LibraryCatalog,
  installationId = "desktop-node",
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
