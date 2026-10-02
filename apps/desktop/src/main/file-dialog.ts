import { dialog, type BrowserWindow } from "electron";

export async function showOpenFileNativeDialog(
  window: BrowserWindow,
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: "Open Publication",
    properties: ["openFile"],
    filters: [
      { name: "Electronic Publications", extensions: ["epub", "pdf"] },
      { name: "EPUB Publications", extensions: ["epub"] },
      { name: "PDF Documents", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

export async function showOpenMultipleFilesNativeDialog(
  window: BrowserWindow,
): Promise<string[]> {
  const result = await dialog.showOpenDialog(window, {
    title: "Add Publications to Library",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Electronic Publications", extensions: ["epub", "pdf"] },
      { name: "EPUB Publications", extensions: ["epub"] },
      { name: "PDF Documents", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  return result.filePaths;
}

export async function showOpenDirectoryNativeDialog(
  window: BrowserWindow,
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: "Add Publication Folder to Library",
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}
