import type {
  DesktopBridge,
  LoadedPublicationResult,
} from "../../preload/types.js";
import type { SavedReadingPosition } from "@reflowpress/reader";

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
};
