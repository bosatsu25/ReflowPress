import type { NormalizedPublication } from "@reflowpress/core";
import type { SavedReadingPosition } from "@reflowpress/reader";

export interface LoadedPublicationResult {
  readonly kind: "epub" | "pdf";
  readonly path: string;
  readonly publicationId: string;
  readonly publication?: NormalizedPublication;
  readonly title: string;
}

export interface DesktopBridge {
  openFileDialog(): Promise<string | null>;
  loadPublication(filePath: string): Promise<LoadedPublicationResult>;
  readPdfBytes(filePath: string): Promise<Uint8Array>;
  loadReadingPosition(
    publicationId: string,
  ): Promise<SavedReadingPosition | null>;
  saveReadingPosition(position: SavedReadingPosition): Promise<void>;
  getInitialFile?(): Promise<string | null>;
  onOpenInitialFile?(callback: (filePath: string) => void): () => void;
}

declare global {
  interface Window {
    readonly reflowPressDesktop?: DesktopBridge;
  }
}
