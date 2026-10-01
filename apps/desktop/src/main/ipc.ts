import { ipcMain, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEpub } from "@reflowpress/epub";
import type { LoadedPublicationResult } from "../preload/types.js";
import type { SavedReadingPosition } from "@reflowpress/reader";
import { showOpenFileNativeDialog } from "./file-dialog.js";
import type { ReadingPositionStore } from "./reading-position-store.js";

export function registerIpcHandlers(
  window: BrowserWindow,
  positionStore: ReadingPositionStore,
  initialFilePath: string | null = null,
): void {
  ipcMain.handle("app:get-initial-file", async () => {
    return initialFilePath;
  });

  ipcMain.handle("dialog:open-file", async () => {
    return showOpenFileNativeDialog(window);
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
}
