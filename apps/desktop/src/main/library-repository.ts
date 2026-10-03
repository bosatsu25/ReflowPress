import { readFile, rename, mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import {
  type LibraryCatalog,
  type LibraryRepository,
  type LibraryBook,
  createDefaultCatalog,
  CURRENT_SCHEMA_VERSION,
} from "@reflowpress/library";

export class JsonLibraryRepository implements LibraryRepository {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<LibraryCatalog> {
    try {
      const data = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(data) as Partial<LibraryCatalog>;

      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.schemaVersion === CURRENT_SCHEMA_VERSION &&
        Array.isArray(parsed.books) &&
        Array.isArray(parsed.collections)
      ) {
        return parsed as LibraryCatalog;
      }

      // If schema structure is invalid, treat as corrupt
      await this.quarantineCorruptFile();
      return createDefaultCatalog();
    } catch (err: unknown) {
      const isMissing =
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "ENOENT";

      if (isMissing) {
        return createDefaultCatalog();
      }

      // Syntax error or file read fault: quarantine and recover
      console.warn(
        `[ReflowPress Library] Corrupt library catalog detected at ${this.filePath}. Quarantining and starting fresh.`,
        err,
      );
      await this.quarantineCorruptFile();
      return createDefaultCatalog();
    }
  }

  async save(catalog: LibraryCatalog): Promise<void> {
    catalog.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const json = JSON.stringify(catalog, null, 2);

    // Open handle, write, fsync to disk to prevent corrupted partial writes
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(json, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Atomic rename
    await rename(tempPath, this.filePath);
  }

  async verifyAvailability(catalog: LibraryCatalog): Promise<LibraryCatalog> {
    const now = new Date().toISOString();
    const updatedBooks: LibraryBook[] = await Promise.all(
      catalog.books.map(async (book) => {
        try {
          const stats = await stat(book.filePath);
          return {
            ...book,
            fileSizeBytes: stats.size,
            modifiedTimeMs: stats.mtimeMs,
            availability: {
              exists: true,
              lastChecked: now,
              fileSizeBytes: stats.size,
              lastModified: stats.mtime.toISOString(),
            },
          };
        } catch {
          return {
            ...book,
            availability: {
              exists: false,
              lastChecked: now,
            },
          };
        }
      }),
    );

    return {
      ...catalog,
      books: updatedBooks,
    };
  }

  private async quarantineCorruptFile(): Promise<void> {
    try {
      const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, corruptPath);
      console.warn(
        `[ReflowPress Library] Quarantined corrupted catalog to ${corruptPath}`,
      );
    } catch {
      // Ignore if rename fails (e.g. file disappeared)
    }
  }
}
