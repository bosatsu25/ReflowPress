import { ipcMain, type BrowserWindow } from "electron";
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
  type SyncRecord,
  type SyncLibraryBookData,
} from "@reflowpress/sync";
import {
  FilesystemDeviceAdapter,
  type TransferItem,
} from "@reflowpress/device";
import type { LoadedPublicationResult } from "../preload/types.js";
import type { SavedReadingPosition } from "@reflowpress/reader";
import {
  type LibraryBook,
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
} from "./file-dialog.js";
import type { ReadingPositionStore } from "./reading-position-store.js";
import type { JsonLibraryRepository } from "./library-repository.js";
import type { JsonAnnotationRepository } from "./annotation-repository.js";
import { scanLibraryPaths } from "./library-scanner.js";

export function registerIpcHandlers(
  window: BrowserWindow,
  positionStore: ReadingPositionStore,
  libraryRepo: JsonLibraryRepository,
  annotationRepo: JsonAnnotationRepository,
  coversDir: string,
  initialFilePath: string | null = null,
): void {
  ipcMain.handle("app:get-initial-file", async () => {
    return initialFilePath;
  });

  ipcMain.handle("dialog:open-file", async () => {
    return showOpenFileNativeDialog(window);
  });

  ipcMain.handle("dialog:open-multiple-files", async () => {
    return showOpenMultipleFilesNativeDialog(window);
  });

  ipcMain.handle("dialog:open-directory", async () => {
    return showOpenDirectoryNativeDialog(window);
  });

  ipcMain.handle(
    "publication:load",
    async (_event, filePath: string): Promise<LoadedPublicationResult> => {
      const ext = path.extname(filePath).toLowerCase();
      const normalizedAbsPath = path.resolve(filePath);

      if (ext === ".epub") {
        const pub = await loadEpub(normalizedAbsPath);
        const publicationId =
          pub.metadata.identifier || `path:${normalizedAbsPath}`;
        const title = pub.metadata.title || path.basename(filePath);

        return {
          kind: "epub",
          path: normalizedAbsPath,
          publicationId,
          publication: pub,
          title,
        };
      }

      if (ext === ".pdf") {
        const publicationId = `path:${normalizedAbsPath}`;
        const title = path.basename(filePath, ".pdf");

        return {
          kind: "pdf",
          path: normalizedAbsPath,
          publicationId,
          title,
        };
      }

      throw new Error(`Unsupported publication format: ${ext}`);
    },
  );

  ipcMain.handle("publication:read-pdf", async (_event, filePath: string) => {
    const buffer = await readFile(filePath);
    return buffer;
  });

  ipcMain.handle("position:get", async (_event, publicationId: string) => {
    return positionStore.getPosition(publicationId);
  });

  ipcMain.handle(
    "position:set",
    async (_event, position: SavedReadingPosition) => {
      await positionStore.savePosition(position);
    },
  );

  // Library Handlers
  ipcMain.handle("library:load", async () => {
    const catalog = await libraryRepo.load();
    const verified = await libraryRepo.verifyAvailability(catalog);
    return verified;
  });

  ipcMain.handle("library:save", async (_event, catalog: LibraryCatalog) => {
    await libraryRepo.save(catalog);
  });

  ipcMain.handle(
    "library:scan-paths",
    async (
      _event,
      pathsToScan: string[],
    ): Promise<{ catalog: LibraryCatalog; result: ScanResult }> => {
      const currentCatalog = await libraryRepo.load();
      const { catalog: updatedCatalog, result } = await scanLibraryPaths(
        pathsToScan,
        currentCatalog,
        coversDir,
      );
      await libraryRepo.save(updatedCatalog);
      return { catalog: updatedCatalog, result };
    },
  );

  ipcMain.handle("library:remove-book", async (_event, bookId: string) => {
    const catalog = await libraryRepo.load();
    const updated = removeBookFromCatalog(catalog, bookId);
    await libraryRepo.save(updated);
    return updated;
  });

  ipcMain.handle(
    "library:update-book",
    async (
      _event,
      bookId: string,
      updates: Partial<LibraryBook>,
    ): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const updated = updateBookInCatalog(catalog, bookId, updates);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  ipcMain.handle(
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

  ipcMain.handle(
    "library:delete-collection",
    async (_event, collectionId: string): Promise<LibraryCatalog> => {
      const catalog = await libraryRepo.load();
      const updated = deleteCollection(catalog, collectionId);
      await libraryRepo.save(updated);
      return updated;
    },
  );

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle(
    "library:read-cover",
    async (_event, coverPath: string): Promise<string | null> => {
      try {
        const buffer = await readFile(coverPath);
        const ext = path.extname(coverPath).toLowerCase();
        const mimeType =
          ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : ext === ".webp"
              ? "image/webp"
              : "image/png";
        return `data:${mimeType};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle("annotations:load", async (): Promise<AnnotationStore> => {
    return annotationRepo.load();
  });

  ipcMain.handle(
    "annotations:save",
    async (_event, store: AnnotationStore): Promise<void> => {
      await annotationRepo.save(store);
    },
  );

  ipcMain.handle(
    "annotations:export",
    async (
      _event,
      publication: PublicationIdentity,
      format: "json" | "markdown" | "html",
      targetPath: string,
      publicationId?: string,
    ): Promise<void> => {
      await annotationRepo.exportToFile(
        publication,
        format,
        targetPath,
        publicationId,
      );
    },
  );

  ipcMain.handle(
    "annotations:import",
    async (
      _event,
      sourcePath: string,
      targetPublicationId: string,
    ): Promise<ImportReport> => {
      return annotationRepo.importFromFile(sourcePath, targetPublicationId);
    },
  );

  ipcMain.handle(
    "dialog:save-file",
    async (
      _event,
      options: {
        title: string;
        defaultPath?: string;
        filters: Array<{ name: string; extensions: string[] }>;
      },
    ): Promise<string | null> => {
      return showSaveFileDialog(window, options);
    },
  );

  ipcMain.handle(
    "dialog:open-annotation-file",
    async (): Promise<string | null> => {
      return showOpenAnnotationFileDialog(window);
    },
  );

  ipcMain.handle("publication:inspect", async (_event, filePath: string) => {
    if (filePath.toLowerCase().endsWith(".pdf")) {
      const bytes = await readFile(filePath);
      return inspectPdfHealth(bytes, filePath);
    }
    return inspectEpubHealth(filePath);
  });

  ipcMain.handle(
    "publication:repair",
    async (
      _event,
      filePath: string,
      options?: { apply?: boolean; ruleId?: string; outputDir?: string },
    ) => {
      const report = await inspectEpubHealth(filePath);
      const { plan, preview } = planRepairs(report, {
        specificRuleIds: options?.ruleId ? [options.ruleId] : undefined,
      });

      if (!options?.apply) {
        return { plan, preview };
      }

      return executeRepair(filePath, plan, {
        outputDir: options?.outputDir,
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
  ipcMain.handle(
    "opds:start",
    async (_event, options?: { port?: number; allowLan?: boolean }) => {
      if (activeOpdsServer) {
        await activeOpdsServer.stop();
      }
      activeOpdsServer = new OpdsServer({
        port: options?.port ?? 3000,
        allowLan: options?.allowLan ?? false,
        getCatalog: () => libraryRepo.load(),
      });
      activeOpdsInfo = await activeOpdsServer.start();
      return activeOpdsInfo;
    },
  );

  ipcMain.handle("opds:stop", async () => {
    if (activeOpdsServer) {
      await activeOpdsServer.stop();
      activeOpdsServer = null;
      activeOpdsInfo = null;
    }
  });

  ipcMain.handle("opds:status", async () => {
    return {
      running: Boolean(activeOpdsServer),
      url: activeOpdsInfo?.url,
      port: activeOpdsInfo?.port,
      isLan: activeOpdsInfo?.isLan,
    };
  });

  // Sync Handlers
  ipcMain.handle(
    "sync:folder",
    async (_event, targetDir: string, options?: { dryRun?: boolean }) => {
      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);
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

        if (!options?.dryRun) {
          await adapter.writeSnapshot(mergeResult.snapshot);
          const remoteBooks = mergeResult.snapshot.books.map(
            (b: SyncRecord<SyncLibraryBookData>) => ({
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
            }),
          );
          catalog.books = remoteBooks;
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

  ipcMain.handle(
    "sync:webdav",
    async (
      _event,
      url: string,
      username?: string,
      password?: string,
      options?: { dryRun?: boolean },
    ) => {
      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);
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

      if (!options?.dryRun) {
        await adapter.writeSnapshot(mergeResult.snapshot);
        const remoteBooks = mergeResult.snapshot.books.map(
          (b: SyncRecord<SyncLibraryBookData>) => ({
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
          }),
        );
        catalog.books = remoteBooks;
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
  ipcMain.handle("backup:create", async (_event, outputPath: string) => {
    const catalog = await libraryRepo.load();
    const snapshot = catalogToSnapshot(catalog);
    const bundleFiles = serializeSyncBundle(snapshot);
    await writeFile(outputPath, JSON.stringify(bundleFiles, null, 2), "utf-8");
    return {
      success: true,
      outputPath,
      count: snapshot.books.length,
    };
  });

  ipcMain.handle("restore:preview", async (_event, bundlePath: string) => {
    const raw = await readFile(path.resolve(bundlePath), "utf-8");
    const bundleMap = JSON.parse(raw) as Record<string, string>;
    const remoteSnapshot = deserializeSyncBundle(bundleMap);
    const catalog = await libraryRepo.load();
    const localSnapshot = catalogToSnapshot(catalog);
    return createRestorePlan(remoteSnapshot, localSnapshot);
  });

  ipcMain.handle(
    "restore:apply",
    async (
      _event,
      bundlePath: string,
      policy?: "keep-local" | "keep-remote" | "keep-both",
    ) => {
      const raw = await readFile(path.resolve(bundlePath), "utf-8");
      const bundleMap = JSON.parse(raw) as Record<string, string>;
      const remoteSnapshot = deserializeSyncBundle(bundleMap);
      const catalog = await libraryRepo.load();
      const localSnapshot = catalogToSnapshot(catalog);

      const { restoredSnapshot, resolvedConflicts } = applyRestore(
        remoteSnapshot,
        localSnapshot,
        { conflictPolicy: policy ?? "keep-local" },
      );

      catalog.books = restoredSnapshot.books.map(
        (b: SyncRecord<SyncLibraryBookData>) => ({
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
        }),
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
  ipcMain.handle("device:discover", async (_event, targetDir?: string) => {
    const mountDir = path.resolve(targetDir ?? process.cwd());
    const adapter = new FilesystemDeviceAdapter(mountDir);
    return adapter.discover();
  });

  ipcMain.handle(
    "device:transfer",
    async (_event, targetMount: string, bookIds: string[]) => {
      const catalog = await libraryRepo.load();
      const booksToTransfer = catalog.books.filter((b) =>
        bookIds.includes(b.id),
      );

      const adapter = new FilesystemDeviceAdapter(path.resolve(targetMount));
      const devices = await adapter.discover();
      const dev = devices[0];
      if (!dev) {
        throw new Error(
          `No valid target e-reader device found at '${targetMount}'`,
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
