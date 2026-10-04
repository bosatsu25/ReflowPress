import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DeviceProfile } from "./models.js";

export const KNOWN_PROFILES: Record<DeviceProfile["id"], DeviceProfile> = {
  kindle: {
    id: "kindle",
    name: "Amazon Kindle",
    booksDirectory: "documents",
    supportedFormats: ["pdf"], // Standard modern Kindles primarily take PDFs or AZW3 over USB
  },
  kobo: {
    id: "kobo",
    name: "Rakuten Kobo",
    booksDirectory: "", // Kobo scans root and subfolders for .epub/.kepub
    supportedFormats: ["epub", "kepub", "pdf"],
  },
  pocketbook: {
    id: "pocketbook",
    name: "PocketBook",
    booksDirectory: "Books",
    supportedFormats: ["epub", "pdf"],
  },
  generic: {
    id: "generic",
    name: "Generic E-Reader / USB Storage",
    booksDirectory: "",
    supportedFormats: ["epub", "pdf"],
  },
};

/**
 * Detects known e-reader filesystem markers inside the mounted root.
 */
export async function detectDeviceProfile(
  rootPath: string,
): Promise<DeviceProfile> {
  const checkDirExists = async (sub: string): Promise<boolean> => {
    try {
      const s = await fs.stat(path.join(rootPath, sub));
      return s.isDirectory();
    } catch {
      return false;
    }
  };

  // Kobo check: .kobo directory
  if (await checkDirExists(".kobo")) {
    return KNOWN_PROFILES.kobo;
  }

  // Kindle check: documents directory AND system directory (standard Kindle mass storage layout)
  const hasDocuments = await checkDirExists("documents");
  const hasSystem = await checkDirExists("system");

  if (hasDocuments && (hasSystem || (await checkDirExists(".kindle")))) {
    return KNOWN_PROFILES.kindle;
  }

  // PocketBook check: Pocketbook, Books, or system directory (without documents)
  if (
    (await checkDirExists("Pocketbook")) ||
    (await checkDirExists("Books")) ||
    hasSystem
  ) {
    return KNOWN_PROFILES.pocketbook;
  }

  return KNOWN_PROFILES.generic;
}
