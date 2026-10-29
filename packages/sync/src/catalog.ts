import type { LibraryBook } from "@reflowpress/library";
import type { SyncLibraryBookData, SyncRecord } from "./models.js";

/**
 * Applies merged sync records to the local catalog.
 *
 * Sync bundles carry portable metadata only. Books that already exist
 * locally keep their file path, size, cover and availability, so a sync or
 * restore never detaches the library from the files on disk. Books that
 * exist only remotely are added without a file path.
 */
export function syncRecordsToCatalogBooks(
  records: readonly SyncRecord<SyncLibraryBookData>[],
  localBooks: readonly LibraryBook[],
  now: Date = new Date(),
): LibraryBook[] {
  const localById = new Map(localBooks.map((book) => [book.id, book]));

  return records.map((record) => {
    const collectionIds = record.data.collections
      ? [...record.data.collections]
      : [];
    const tags = record.data.tags ? [...record.data.tags] : [];
    const local = localById.get(record.id);

    if (local) {
      return {
        ...local,
        title: record.data.title,
        creator: record.data.author,
        collectionIds,
        tags,
      };
    }

    return {
      id: record.id,
      title: record.data.title,
      creator: record.data.author,
      format: record.data.format,
      collectionIds,
      tags,
      dateAdded: record.updatedAt,
      filePath: "",
      fileSizeBytes: 0,
      modifiedTimeMs: now.getTime(),
      availability: {
        exists: false,
        lastChecked: now.toISOString(),
      },
    };
  });
}
