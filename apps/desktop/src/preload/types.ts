import type { NormalizedPublication } from "@reflowpress/core";
import type { SavedReadingPosition } from "@reflowpress/reader";
import type {
  LibraryBook,
  LibraryCatalog,
  ScanResult,
} from "@reflowpress/library";
import type {
  AnnotationStore,
  PublicationIdentity,
  ImportReport,
} from "@reflowpress/annotations";
import type { HealthReport } from "@reflowpress/quality";
import type { RepairResult } from "@reflowpress/repair";

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
  // Annotations API
  loadAnnotations(): Promise<AnnotationStore>;
  saveAnnotations(store: AnnotationStore): Promise<void>;
  exportAnnotations(
    publication: PublicationIdentity,
    format: "json" | "markdown" | "html",
    targetPath: string,
    publicationId?: string,
  ): Promise<void>;
  importAnnotations(
    sourcePath: string,
    targetPublicationId: string,
  ): Promise<ImportReport>;
  showSaveFileDialog(options: {
    title: string;
    defaultPath?: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  showOpenAnnotationFileDialog(): Promise<string | null>;
  // Quality & Safe Repair API
  inspectPublication(filePath: string): Promise<HealthReport>;
  repairPublication(
    filePath: string,
    options?: { apply?: boolean; ruleId?: string; outputDir?: string },
  ): Promise<RepairResult>;
}

declare global {
  interface Window {
    readonly reflowPressDesktop?: DesktopBridge;
  }
}
