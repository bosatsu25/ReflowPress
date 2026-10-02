import type {
  BookFilterCriteria,
  BookSortCriteria,
  LibraryBook,
  LibraryCatalog,
  LibraryCollection,
} from "./models.js";

export const CURRENT_SCHEMA_VERSION = 1;

export function createDefaultCatalog(): LibraryCatalog {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    books: [],
    collections: [],
    scanPaths: [],
  };
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "").toLowerCase();
}

export function filterBooks(
  books: LibraryBook[],
  criteria: BookFilterCriteria,
): LibraryBook[] {
  let filtered = [...books];

  if (criteria.format && criteria.format !== "all") {
    filtered = filtered.filter((b) => b.format === criteria.format);
  }

  if (criteria.collectionId) {
    filtered = filtered.filter((b) =>
      b.collectionIds.includes(criteria.collectionId!),
    );
  }

  if (criteria.tag) {
    const targetTag = normalizeTag(criteria.tag);
    filtered = filtered.filter((b) =>
      b.tags.map(normalizeTag).includes(targetTag),
    );
  }

  if (criteria.query && criteria.query.trim().length > 0) {
    const q = criteria.query.trim().toLowerCase();
    filtered = filtered.filter((b) => {
      const matchTitle = b.title.toLowerCase().includes(q);
      const matchCreator = b.creator?.toLowerCase().includes(q) ?? false;
      const matchPublisher = b.publisher?.toLowerCase().includes(q) ?? false;
      const matchIdentifier = b.identifier?.toLowerCase().includes(q) ?? false;
      const matchTags = b.tags.some((t) => t.toLowerCase().includes(q));
      return (
        matchTitle ||
        matchCreator ||
        matchPublisher ||
        matchIdentifier ||
        matchTags
      );
    });
  }

  return filtered;
}

export function sortBooks(
  books: LibraryBook[],
  criteria: BookSortCriteria,
): LibraryBook[] {
  const { field, direction } = criteria;
  const modifier = direction === "desc" ? -1 : 1;

  return [...books].sort((a, b) => {
    switch (field) {
      case "title":
        return (
          modifier *
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        );
      case "creator": {
        const creatorA = a.creator || "";
        const creatorB = b.creator || "";
        if (!creatorA && !creatorB) return 0;
        if (!creatorA) return 1;
        if (!creatorB) return -1;
        return (
          modifier *
          creatorA.localeCompare(creatorB, undefined, { sensitivity: "base" })
        );
      }
      case "dateAdded":
        return (
          modifier *
          (new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime())
        );
      case "lastOpened": {
        const timeA = a.lastOpened ? new Date(a.lastOpened).getTime() : 0;
        const timeB = b.lastOpened ? new Date(b.lastOpened).getTime() : 0;
        if (timeA === 0 && timeB === 0) return 0;
        if (timeA === 0) return 1; // Unopened books at the end
        if (timeB === 0) return -1;
        return modifier * (timeA - timeB);
      }
      default:
        return 0;
    }
  });
}

export function addBookToCatalog(
  catalog: LibraryCatalog,
  book: LibraryBook,
): LibraryCatalog {
  const existingIndex = catalog.books.findIndex((b) => b.id === book.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = catalog.books[existingIndex]!;
    const updatedBook: LibraryBook = {
      ...book,
      // Preserve user-assigned collections, tags, reading progress and lastOpened if not provided in new book
      tags: book.tags.length > 0 ? book.tags : existing.tags,
      collectionIds:
        book.collectionIds.length > 0
          ? book.collectionIds
          : existing.collectionIds,
      readingProgress: book.readingProgress ?? existing.readingProgress,
      lastOpened: book.lastOpened ?? existing.lastOpened,
      dateAdded: existing.dateAdded,
    };

    const newBooks = [...catalog.books];
    newBooks[existingIndex] = updatedBook;
    return {
      ...catalog,
      updatedAt: now,
      books: newBooks,
    };
  }

  return {
    ...catalog,
    updatedAt: now,
    books: [...catalog.books, book],
  };
}

export function removeBookFromCatalog(
  catalog: LibraryCatalog,
  bookId: string,
): LibraryCatalog {
  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    books: catalog.books.filter((b) => b.id !== bookId),
  };
}

export function updateBookInCatalog(
  catalog: LibraryCatalog,
  bookId: string,
  updates: Partial<LibraryBook>,
): LibraryCatalog {
  const index = catalog.books.findIndex((b) => b.id === bookId);
  if (index === -1) return catalog;

  const existing = catalog.books[index]!;
  const updatedBook: LibraryBook = {
    ...existing,
    ...updates,
    id: existing.id, // ID must remain immutable
  };

  const newBooks = [...catalog.books];
  newBooks[index] = updatedBook;

  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    books: newBooks,
  };
}

export function createCollection(
  catalog: LibraryCatalog,
  name: string,
  description?: string,
): { catalog: LibraryCatalog; collection: LibraryCollection } {
  const now = new Date().toISOString();
  const id = `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const collection: LibraryCollection = {
    id,
    name: name.trim(),
    description: description?.trim(),
    createdAt: now,
    updatedAt: now,
  };

  return {
    catalog: {
      ...catalog,
      updatedAt: now,
      collections: [...catalog.collections, collection],
    },
    collection,
  };
}

export function deleteCollection(
  catalog: LibraryCatalog,
  collectionId: string,
): LibraryCatalog {
  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    collections: catalog.collections.filter((c) => c.id !== collectionId),
    books: catalog.books.map((b) => ({
      ...b,
      collectionIds: b.collectionIds.filter((cid) => cid !== collectionId),
    })),
  };
}

export function addBookToCollection(
  catalog: LibraryCatalog,
  bookId: string,
  collectionId: string,
): LibraryCatalog {
  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    books: catalog.books.map((b) => {
      if (b.id !== bookId || b.collectionIds.includes(collectionId)) return b;
      return {
        ...b,
        collectionIds: [...b.collectionIds, collectionId],
      };
    }),
  };
}

export function removeBookFromCollection(
  catalog: LibraryCatalog,
  bookId: string,
  collectionId: string,
): LibraryCatalog {
  return {
    ...catalog,
    updatedAt: new Date().toISOString(),
    books: catalog.books.map((b) => {
      if (b.id !== bookId || !b.collectionIds.includes(collectionId)) return b;
      return {
        ...b,
        collectionIds: b.collectionIds.filter((cid) => cid !== collectionId),
      };
    }),
  };
}
