import type { NormalizedPublication } from "@reflowpress/core";
import type { SavedReadingPosition } from "@reflowpress/reader";
import type {
  LibraryBook,
  LibraryCatalog,
  ScanResult,
} from "@reflowpress/library";

export interface LoadedPublicationResult {
  readonly kind: "epub" | "pdf";
  readonly path: string;
  readonly publicationId: string;
  readonly publication?: NormalizedPublication;
  readonly title: string;
}

export interface DesktopBridge {
  openFileDialog(): Promise<string | null>;
  openMultipleFilesDialog(): Promise<string[]>;
  openDirectoryDialog(): Promise<string | null>;
  loadPublication(filePath: string): Promise<LoadedPublicationResult>;
  readPdfBytes(filePath: string): Promise<Uint8Array>;
  loadReadingPosition(
    publicationId: string,
  ): Promise<SavedReadingPosition | null>;
  saveReadingPosition(position: SavedReadingPosition): Promise<void>;
  getInitialFile?(): Promise<string | null>;
  onOpenInitialFile?(callback: (filePath: string) => void): () => void;
  // Library API
  loadLibrary(): Promise<LibraryCatalog>;
  saveLibrary(catalog: LibraryCatalog): Promise<void>;
  scanLibraryPaths(
    paths: string[],
  ): Promise<{ catalog: LibraryCatalog; result: ScanResult }>;
  removeBookFromLibrary(bookId: string): Promise<LibraryCatalog>;
  updateBookInLibrary(
    bookId: string,
    updates: Partial<LibraryBook>,
  ): Promise<LibraryCatalog>;
  createLibraryCollection(
    name: string,
    description?: string,
  ): Promise<LibraryCatalog>;
  deleteLibraryCollection(collectionId: string): Promise<LibraryCatalog>;
  addBookToLibraryCollection(
    bookId: string,
    collectionId: string,
  ): Promise<LibraryCatalog>;
  removeBookFromLibraryCollection(
    bookId: string,
    collectionId: string,
  ): Promise<LibraryCatalog>;
  readCoverImage(coverPath: string): Promise<string | null>;
}

declare global {
  interface Window {
    readonly reflowPressDesktop?: DesktopBridge;
  }
}
