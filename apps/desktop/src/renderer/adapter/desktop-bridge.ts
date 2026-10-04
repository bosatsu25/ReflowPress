import type {
  DesktopBridge,
  LoadedPublicationResult,
} from "../../preload/types.js";
import type { SavedReadingPosition } from "@reflowpress/reader";
import type {
  LibraryBook,
  LibraryCatalog,
  ScanResult,
} from "@reflowpress/library";

function getBridge(): DesktopBridge {
  if (typeof window !== "undefined" && window.reflowPressDesktop) {
    return window.reflowPressDesktop;
  }
  throw new Error(
    "ReflowPress Desktop bridge is not available. Ensure you are running within the Electron shell.",
  );
}

export const desktopBridge: DesktopBridge = {
  openFileDialog(): Promise<string | null> {
    return getBridge().openFileDialog();
  },
  openMultipleFilesDialog(): Promise<string[]> {
    return getBridge().openMultipleFilesDialog();
  },
  openDirectoryDialog(): Promise<string | null> {
    return getBridge().openDirectoryDialog();
  },
  loadPublication(filePath: string): Promise<LoadedPublicationResult> {
    return getBridge().loadPublication(filePath);
  },
  readPdfBytes(filePath: string): Promise<Uint8Array> {
    return getBridge().readPdfBytes(filePath);
  },
  loadReadingPosition(
    publicationId: string,
  ): Promise<SavedReadingPosition | null> {
    return getBridge().loadReadingPosition(publicationId);
  },
  saveReadingPosition(position: SavedReadingPosition): Promise<void> {
    return getBridge().saveReadingPosition(position);
  },
  getInitialFile(): Promise<string | null> {
    if (
      typeof window !== "undefined" &&
      window.reflowPressDesktop?.getInitialFile
    ) {
      return window.reflowPressDesktop.getInitialFile();
    }
    return Promise.resolve(null);
  },
  onOpenInitialFile(callback: (filePath: string) => void): () => void {
    if (
      typeof window !== "undefined" &&
      window.reflowPressDesktop?.onOpenInitialFile
    ) {
      return window.reflowPressDesktop.onOpenInitialFile(callback);
    }
    return () => {};
  },
  getCrashRecoveryStatus() {
    if (
      typeof window !== "undefined" &&
      window.reflowPressDesktop?.getCrashRecoveryStatus
    ) {
      return window.reflowPressDesktop.getCrashRecoveryStatus();
    }
    return Promise.resolve(null);
  },
  clearCrashRecoveryStatus() {
    if (
      typeof window !== "undefined" &&
      window.reflowPressDesktop?.clearCrashRecoveryStatus
    ) {
      return window.reflowPressDesktop.clearCrashRecoveryStatus();
    }
    return Promise.resolve(true);
  },
  loadLibrary(): Promise<LibraryCatalog> {
    return getBridge().loadLibrary();
  },
  saveLibrary(catalog: LibraryCatalog): Promise<void> {
    return getBridge().saveLibrary(catalog);
  },
  scanLibraryPaths(
    paths: string[],
  ): Promise<{ catalog: LibraryCatalog; result: ScanResult }> {
    return getBridge().scanLibraryPaths(paths);
  },
  removeBookFromLibrary(bookId: string): Promise<LibraryCatalog> {
    return getBridge().removeBookFromLibrary(bookId);
  },
  updateBookInLibrary(
    bookId: string,
    updates: Partial<LibraryBook>,
  ): Promise<LibraryCatalog> {
    return getBridge().updateBookInLibrary(bookId, updates);
  },
  createLibraryCollection(
    name: string,
    description?: string,
  ): Promise<LibraryCatalog> {
    return getBridge().createLibraryCollection(name, description);
  },
  deleteLibraryCollection(collectionId: string): Promise<LibraryCatalog> {
    return getBridge().deleteLibraryCollection(collectionId);
  },
  addBookToLibraryCollection(
    bookId: string,
    collectionId: string,
  ): Promise<LibraryCatalog> {
    return getBridge().addBookToLibraryCollection(bookId, collectionId);
  },
  removeBookFromLibraryCollection(
    bookId: string,
    collectionId: string,
  ): Promise<LibraryCatalog> {
    return getBridge().removeBookFromLibraryCollection(bookId, collectionId);
  },
  readCoverImage(coverPath: string): Promise<string | null> {
    return getBridge().readCoverImage(coverPath);
  },
  loadAnnotations() {
    return getBridge().loadAnnotations();
  },
  saveAnnotations(store) {
    return getBridge().saveAnnotations(store);
  },
  exportAnnotations(publication, format, targetPath, publicationId) {
    return getBridge().exportAnnotations(
      publication,
      format,
      targetPath,
      publicationId,
    );
  },
  importAnnotations(sourcePath, targetPublicationId) {
    return getBridge().importAnnotations(sourcePath, targetPublicationId);
  },
  showSaveFileDialog(options) {
    return getBridge().showSaveFileDialog(options);
  },
  showOpenAnnotationFileDialog() {
    return getBridge().showOpenAnnotationFileDialog();
  },
  inspectPublication(filePath) {
    return getBridge().inspectPublication(filePath);
  },
  repairPublication(filePath, options) {
    return getBridge().repairPublication(filePath, options);
  },
  opdsStart(options) {
    return getBridge().opdsStart(options);
  },
  opdsStop() {
    return getBridge().opdsStop();
  },
  opdsGetStatus() {
    return getBridge().opdsGetStatus();
  },
  syncFolder(targetDir, options) {
    return getBridge().syncFolder(targetDir, options);
  },
  syncWebdav(url, username, password, options) {
    return getBridge().syncWebdav(url, username, password, options);
  },
  createBackup(outputPath) {
    return getBridge().createBackup(outputPath);
  },
  previewRestore(bundlePath) {
    return getBridge().previewRestore(bundlePath);
  },
  applyRestore(bundlePath, policy) {
    return getBridge().applyRestore(bundlePath, policy);
  },
  discoverDevices(targetDir) {
    return getBridge().discoverDevices(targetDir);
  },
  transferToDevice(targetMount, bookIds) {
    return getBridge().transferToDevice(targetMount, bookIds);
  },
};
