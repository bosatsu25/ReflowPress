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
};
