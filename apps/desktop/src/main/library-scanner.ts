import { readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEpub } from "@reflowpress/epub";
import {
  type LibraryBook,
  type LibraryCatalog,
  type ScanResult,
  addBookToCatalog,
} from "@reflowpress/library";

export async function findPublicationFiles(
  targets: string[],
): Promise<string[]> {
  const found: string[] = [];

  async function walk(targetPath: string): Promise<void> {
    try {
      const stats = await stat(targetPath);
      if (stats.isDirectory()) {
        const entries = await readdir(targetPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(targetPath, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === ".epub" || ext === ".pdf") {
              found.push(path.resolve(fullPath));
            }
          }
        }
      } else if (stats.isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        if (ext === ".epub" || ext === ".pdf") {
          found.push(path.resolve(targetPath));
        }
      }
    } catch (err) {
      console.warn(
        `[LibraryScanner] Failed to access path: ${targetPath}`,
        err,
      );
    }
  }

  for (const target of targets) {
    await walk(path.resolve(target));
  }

  return Array.from(new Set(found));
}

export function computeBookId(normalizedFilePath: string): string {
  return createHash("sha256")
    .update(path.normalize(normalizedFilePath).toLowerCase())
    .digest("hex");
}

export async function extractEpubMetadataAndCover(
  filePath: string,
  bookId: string,
  coversDir: string,
): Promise<{
  title: string;
  creator?: string | undefined;
  publisher?: string | undefined;
  language?: string | undefined;
  description?: string | undefined;
  identifier?: string | undefined;
  coverPath?: string | undefined;
}> {
  const pub = await loadEpub(filePath);
  const metadata = pub.metadata;

  let coverPath: string | undefined = undefined;

  // Attempt to find cover in resources
  const coverResource = pub.resources.find(
    (r) =>
      r.mediaType.startsWith("image/") &&
      (r.href.toLowerCase().includes("cover") ||
        r.href.toLowerCase().includes("thumbnail")),
  );

  if (coverResource && coverResource.bytes.length > 0) {
    try {
      await mkdir(coversDir, { recursive: true });
      const ext = path.extname(coverResource.href) || ".png";
      const coverFileName = `${bookId}${ext}`;
      const targetCoverPath = path.join(coversDir, coverFileName);
      await writeFile(targetCoverPath, Buffer.from(coverResource.bytes));
      coverPath = targetCoverPath;
    } catch {
      // Cover extraction is best-effort; don't fail metadata ingestion
    }
  }

  const creator =
    typeof metadata.creator === "string"
      ? metadata.creator
      : Array.isArray(metadata.creator)
        ? (metadata.creator as readonly string[]).join(", ")
        : undefined;

  return {
    title: metadata.title || path.basename(filePath, ".epub"),
    creator,
    publisher: metadata.publisher,
    language: metadata.language,
    description: metadata.description,
    identifier: metadata.identifier,
    coverPath,
  };
}

export async function scanLibraryPaths(
  pathsToScan: string[],
  existingCatalog: LibraryCatalog,
  coversDir: string,
): Promise<{ catalog: LibraryCatalog; result: ScanResult }> {
  const filePaths = await findPublicationFiles(pathsToScan);
  let updatedCatalog = { ...existingCatalog };

  const result: ScanResult = {
    added: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  };

  for (const filePath of filePaths) {
    const id = computeBookId(filePath);
    let stats;
    try {
      stats = await stat(filePath);
    } catch (err) {
      result.failed++;
      result.errors.push({
        filePath,
        message:
          err instanceof Error ? err.message : "Failed to access publication",
      });
      continue;
    }

    const existingBook = updatedCatalog.books.find((b) => b.id === id);

    // Incremental check: if size & mtime match and already indexed, skip heavy parsing
    if (
      existingBook &&
      existingBook.fileSizeBytes === stats.size &&
      existingBook.modifiedTimeMs === stats.mtimeMs &&
      existingBook.availability.exists
    ) {
      result.unchanged++;
      continue;
    }

    const ext = path.extname(filePath).toLowerCase();
    const now = new Date().toISOString();

    try {
      if (ext === ".epub") {
        const extracted = await extractEpubMetadataAndCover(
          filePath,
          id,
          coversDir,
        );
        const book: LibraryBook = {
          id,
          filePath,
          format: "epub",
          title: extracted.title,
          creator: extracted.creator,
          publisher: extracted.publisher,
          language: extracted.language,
          description: extracted.description,
          identifier: extracted.identifier,
          dateAdded: existingBook?.dateAdded ?? now,
          lastOpened: existingBook?.lastOpened,
          fileSizeBytes: stats.size,
          modifiedTimeMs: stats.mtimeMs,
          coverPath: extracted.coverPath ?? existingBook?.coverPath,
          tags: existingBook?.tags ?? [],
          collectionIds: existingBook?.collectionIds ?? [],
          readingProgress: existingBook?.readingProgress,
          availability: {
            exists: true,
            lastChecked: now,
            fileSizeBytes: stats.size,
            lastModified: stats.mtime.toISOString(),
          },
        };

        updatedCatalog = addBookToCatalog(updatedCatalog, book);
        if (existingBook) {
          result.updated++;
        } else {
          result.added++;
        }
      } else if (ext === ".pdf") {
        const title = path.basename(filePath, ".pdf");
        const book: LibraryBook = {
          id,
          filePath,
          format: "pdf",
          title,
          dateAdded: existingBook?.dateAdded ?? now,
          lastOpened: existingBook?.lastOpened,
          fileSizeBytes: stats.size,
          modifiedTimeMs: stats.mtimeMs,
          coverPath: existingBook?.coverPath,
          tags: existingBook?.tags ?? [],
          collectionIds: existingBook?.collectionIds ?? [],
          readingProgress: existingBook?.readingProgress,
          availability: {
            exists: true,
            lastChecked: now,
            fileSizeBytes: stats.size,
            lastModified: stats.mtime.toISOString(),
          },
        };

        updatedCatalog = addBookToCatalog(updatedCatalog, book);
        if (existingBook) {
          result.updated++;
        } else {
          result.added++;
        }
      }
    } catch (err) {
      result.failed++;
      result.errors.push({
        filePath,
        message:
          err instanceof Error
            ? err.message
            : "Failed to inspect publication file",
      });
    }
  }

  // Update catalog scan paths
  const allScanPaths = Array.from(
    new Set([...updatedCatalog.scanPaths, ...pathsToScan]),
  );
  updatedCatalog.scanPaths = allScanPaths;

  return {
    catalog: updatedCatalog,
    result,
  };
}
