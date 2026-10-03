import { describe, it, expect } from "vitest";
import {
  type LibraryBook,
  type LibraryCatalog,
  createDefaultCatalog,
  normalizeTag,
  filterBooks,
  sortBooks,
  addBookToCatalog,
  removeBookFromCatalog,
  updateBookInCatalog,
  createCollection,
  deleteCollection,
  addBookToCollection,
  removeBookFromCollection,
} from "@reflowpress/library";

describe("Library Domain Operations", () => {
  const sampleBooks: LibraryBook[] = [
    {
      id: "book-1",
      filePath: "/path/to/book-a.epub",
      format: "epub",
      title: "Alpha Book",
      creator: "Author A",
      publisher: "Publisher One",
      dateAdded: "2026-01-01T00:00:00.000Z",
      lastOpened: "2026-01-05T00:00:00.000Z",
      fileSizeBytes: 1000,
      modifiedTimeMs: 123456,
      tags: ["scifi", "classic"],
      collectionIds: ["col-1"],
      availability: { exists: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    },
    {
      id: "book-2",
      filePath: "/path/to/book-b.pdf",
      format: "pdf",
      title: "Beta Manual",
      creator: "Author B",
      publisher: "Doc Press",
      dateAdded: "2026-01-02T00:00:00.000Z",
      lastOpened: undefined,
      fileSizeBytes: 2000,
      modifiedTimeMs: 234567,
      tags: ["manual", "tech"],
      collectionIds: [],
      availability: { exists: true, lastChecked: "2026-01-01T00:00:00.000Z" },
    },
    {
      id: "book-3",
      filePath: "/path/to/book-c.epub",
      format: "epub",
      title: "Gamma Tale",
      creator: "Author C",
      dateAdded: "2026-01-03T00:00:00.000Z",
      lastOpened: "2026-01-04T00:00:00.000Z",
      fileSizeBytes: 1500,
      modifiedTimeMs: 345678,
      tags: ["fantasy"],
      collectionIds: ["col-1"],
      availability: { exists: false, lastChecked: "2026-01-01T00:00:00.000Z" },
    },
  ];

  it("normalizes tags consistently", () => {
    expect(normalizeTag("  #SciFi  ")).toBe("scifi");
    expect(normalizeTag("##Classic")).toBe("classic");
    expect(normalizeTag("Fantasy")).toBe("fantasy");
  });

  it("filters books by query across title, author, publisher, and tags", () => {
    expect(filterBooks(sampleBooks, { query: "alpha" })).toHaveLength(1);
    expect(filterBooks(sampleBooks, { query: "author b" })).toHaveLength(1);
    expect(filterBooks(sampleBooks, { query: "publisher one" })).toHaveLength(
      1,
    );
    expect(filterBooks(sampleBooks, { query: "scifi" })).toHaveLength(1);
    expect(filterBooks(sampleBooks, { query: "nonexistent" })).toHaveLength(0);
  });

  it("filters books by format", () => {
    expect(filterBooks(sampleBooks, { format: "epub" })).toHaveLength(2);
    expect(filterBooks(sampleBooks, { format: "pdf" })).toHaveLength(1);
    expect(filterBooks(sampleBooks, { format: "all" })).toHaveLength(3);
  });

  it("filters books by collection and tag", () => {
    expect(filterBooks(sampleBooks, { collectionId: "col-1" })).toHaveLength(2);
    expect(filterBooks(sampleBooks, { tag: "scifi" })).toHaveLength(1);
    expect(filterBooks(sampleBooks, { tag: "#manual" })).toHaveLength(1);
  });

  it("sorts books by title, author, dateAdded, and lastOpened", () => {
    const byTitleAsc = sortBooks(sampleBooks, {
      field: "title",
      direction: "asc",
    });
    expect(byTitleAsc[0]?.title).toBe("Alpha Book");
    expect(byTitleAsc[2]?.title).toBe("Gamma Tale");

    const byTitleDesc = sortBooks(sampleBooks, {
      field: "title",
      direction: "desc",
    });
    expect(byTitleDesc[0]?.title).toBe("Gamma Tale");

    const byDateAddedDesc = sortBooks(sampleBooks, {
      field: "dateAdded",
      direction: "desc",
    });
    expect(byDateAddedDesc[0]?.id).toBe("book-3");

    const byLastOpenedDesc = sortBooks(sampleBooks, {
      field: "lastOpened",
      direction: "desc",
    });
    expect(byLastOpenedDesc[0]?.id).toBe("book-1");
    expect(byLastOpenedDesc[2]?.id).toBe("book-2"); // unopened at end
  });

  it("manages catalog books addition, update, and removal", () => {
    let catalog: LibraryCatalog = createDefaultCatalog();
    expect(catalog.books).toHaveLength(0);

    catalog = addBookToCatalog(catalog, sampleBooks[0]!);
    expect(catalog.books).toHaveLength(1);

    // Update book
    catalog = updateBookInCatalog(catalog, "book-1", {
      title: "Updated Alpha",
    });
    expect(catalog.books[0]?.title).toBe("Updated Alpha");

    // Remove book
    catalog = removeBookFromCatalog(catalog, "book-1");
    expect(catalog.books).toHaveLength(0);
  });

  it("manages collections creation, deletion, and membership", () => {
    let catalog: LibraryCatalog = createDefaultCatalog();
    catalog = addBookToCatalog(catalog, sampleBooks[0]!);

    const { catalog: catWithCol, collection } = createCollection(
      catalog,
      "Favorites",
      "My favorite books",
    );
    catalog = catWithCol;
    expect(catalog.collections).toHaveLength(1);
    expect(catalog.collections[0]?.name).toBe("Favorites");

    // Add book to collection
    catalog = addBookToCollection(catalog, "book-1", collection.id);
    expect(catalog.books[0]?.collectionIds).toContain(collection.id);

    // Remove book from collection
    catalog = removeBookFromCollection(catalog, "book-1", collection.id);
    expect(catalog.books[0]?.collectionIds).not.toContain(collection.id);

    // Delete collection
    catalog = addBookToCollection(catalog, "book-1", collection.id);
    catalog = deleteCollection(catalog, collection.id);
    expect(catalog.collections).toHaveLength(0);
    expect(catalog.books[0]?.collectionIds).not.toContain(collection.id);
  });
});
