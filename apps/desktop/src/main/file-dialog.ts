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

export type DirectoryPurpose = "library" | "sync" | "device";

const DIRECTORY_DIALOG_TITLES: Record<DirectoryPurpose, string> = {
  library: "Add Publication Folder to Library",
  sync: "Choose Sync Folder",
  device: "Choose E-Reader Drive",
};

export async function showOpenDirectoryNativeDialog(
  window: BrowserWindow,
  purpose: DirectoryPurpose = "library",
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: DIRECTORY_DIALOG_TITLES[purpose],
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

export async function showSaveFileDialog(
  window: BrowserWindow,
  options: {
    title: string;
    defaultPath?: string | undefined;
    filters: Array<{ name: string; extensions: string[] }>;
  },
): Promise<string | null> {
  const dialogOpts: {
    title: string;
    defaultPath?: string;
    filters: Array<{ name: string; extensions: string[] }>;
  } = {
    title: options.title,
    filters: options.filters,
  };
  if (options.defaultPath !== undefined) {
    dialogOpts.defaultPath = options.defaultPath;
  }

  const result = await dialog.showSaveDialog(window, dialogOpts);

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
}

export async function showOpenAnnotationFileDialog(
  window: BrowserWindow,
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: "Import Annotations",
    properties: ["openFile"],
    filters: [
      { name: "ReflowPress Annotations (*.json)", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

export async function showOpenBackupFileDialog(
  window: BrowserWindow,
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title: "Restore ReflowPress Backup",
    properties: ["openFile"],
    filters: [{ name: "ReflowPress Backup (*.json)", extensions: ["json"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}
