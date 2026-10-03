import { ipcMain, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEpub } from "@reflowpress/epub";
import { inspectEpubHealth, inspectPdfHealth } from "@reflowpress/quality";
import { planRepairs, executeRepair } from "@reflowpress/repair";
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
}
