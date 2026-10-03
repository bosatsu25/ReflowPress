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
import type { RestorePlan } from "@reflowpress/sync";
import type { DeviceDescriptor, TransferResult } from "@reflowpress/device";

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
  // Interoperability API
  opdsStart(options?: {
    port?: number;
    allowLan?: boolean;
  }): Promise<{ url: string; port: number; isLan: boolean }>;
  opdsStop(): Promise<void>;
  opdsGetStatus(): Promise<{
    running: boolean;
    url?: string | undefined;
    port?: number | undefined;
    isLan?: boolean | undefined;
  }>;
  syncFolder(
    targetDir: string,
    options?: { dryRun?: boolean },
  ): Promise<{
    appliedRemote: number;
    preservedLocal: number;
    conflicts: number;
    totalBooks: number;
  }>;
  syncWebdav(
    url: string,
    username?: string,
    password?: string,
    options?: { dryRun?: boolean },
  ): Promise<{
    appliedRemote: number;
    preservedLocal: number;
    conflicts: number;
    totalBooks: number;
  }>;
  createBackup(
    outputPath: string,
  ): Promise<{ success: boolean; outputPath: string; count: number }>;
  previewRestore(bundlePath: string): Promise<RestorePlan>;
  applyRestore(
    bundlePath: string,
    policy?: "keep-local" | "keep-remote" | "keep-both",
  ): Promise<{ restoredBooks: number; resolvedConflicts: number }>;
  discoverDevices(targetDir?: string): Promise<readonly DeviceDescriptor[]>;
  transferToDevice(
    targetMount: string,
    bookIds: string[],
  ): Promise<TransferResult>;
}

declare global {
  interface Window {
    readonly reflowPressDesktop?: DesktopBridge;
  }
}
