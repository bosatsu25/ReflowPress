import type { LibraryBook, LibraryCatalog } from "@reflowpress/library";
import {
  type OpdsFeed,
  type OpdsPublication,
  type OpdsLink,
  OPDS2_CATALOG_CONTEXT,
  OPDS2_MIME_TYPE,
  OPDS_RELS,
} from "./models.js";

export interface FeedGeneratorOptions {
  readonly baseUrl: string;
  readonly title?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly itemsPerPage?: number | undefined;
}

export function generateOpds2Catalog(
  catalogOrOptions:
    LibraryCatalog | (FeedGeneratorOptions & { catalog: LibraryCatalog }),
  maybeOptions?: FeedGeneratorOptions,
): OpdsFeed {
  let catalog: LibraryCatalog;
  let options: FeedGeneratorOptions;

  if ("catalog" in catalogOrOptions && catalogOrOptions.catalog) {
    catalog = catalogOrOptions.catalog;
    options = catalogOrOptions;
  } else {
    catalog = catalogOrOptions as LibraryCatalog;
    options = maybeOptions ?? { baseUrl: "" };
  }

  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(
    1,
    (options as { itemsPerPage?: number }).itemsPerPage ??
      options.pageSize ??
      50,
  );

  const totalBooks = catalog.books.length;
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  const startIndex = (page - 1) * pageSize;
  const pagedBooks = catalog.books.slice(startIndex, startIndex + pageSize);

  const selfHref = `${baseUrl}/opds/v2/catalog?page=${page}&pageSize=${pageSize}`;

  const links: OpdsLink[] = [
    {
      href: selfHref,
      type: OPDS2_MIME_TYPE,
      rel: OPDS_RELS.SELF,
    },
    {
      href: `${baseUrl}/opds/v2/catalog?page=1&pageSize=${pageSize}`,
      type: OPDS2_MIME_TYPE,
      rel: OPDS_RELS.FIRST,
    },
    {
      href: `${baseUrl}/opds/v2/catalog?page=${totalPages}&pageSize=${pageSize}`,
      type: OPDS2_MIME_TYPE,
      rel: OPDS_RELS.LAST,
    },
  ];

  if (page > 1) {
    links.push({
      href: `${baseUrl}/opds/v2/catalog?page=${page - 1}&pageSize=${pageSize}`,
      type: OPDS2_MIME_TYPE,
      rel: OPDS_RELS.PREV,
    });
  }

  if (page < totalPages) {
    links.push({
      href: `${baseUrl}/opds/v2/catalog?page=${page + 1}&pageSize=${pageSize}`,
      type: OPDS2_MIME_TYPE,
      rel: OPDS_RELS.NEXT,
    });
  }

  const publications: OpdsPublication[] = pagedBooks.map((book) =>
    mapBookToPublication(book, baseUrl),
  );

  return {
    "@context": OPDS2_CATALOG_CONTEXT,
    metadata: {
      title: options.title ?? "ReflowPress Library",
      numberOfItems: totalBooks,
      modified: new Date().toISOString(),
    },
    links,
    publications,
  };
}

export function mapBookToPublication(
  book: LibraryBook,
  baseUrl: string,
): OpdsPublication {
  const mediaType =
    book.format === "epub" ? "application/epub+zip" : "application/pdf";

  // Opaque URLs with zero host filesystem paths
  const acquisitionHref = `${baseUrl}/opds/v2/publications/${encodeURIComponent(book.id)}/acquisition`;
  const coverHref = `${baseUrl}/opds/v2/publications/${encodeURIComponent(book.id)}/cover`;

  const links: OpdsLink[] = [
    {
      href: acquisitionHref,
      type: mediaType,
      rel: OPDS_RELS.ACQUISITION,
      title: book.title,
    },
  ];

  const images: OpdsLink[] = [
    {
      href: coverHref,
      type: "image/jpeg",
      rel: [OPDS_RELS.IMAGE, OPDS_RELS.IMAGE_THUMBNAIL],
      height: 300,
      width: 200,
    },
  ];

  return {
    metadata: {
      title: book.title,
      identifier: book.identifier ?? book.id,
      author: book.creator ?? "Unknown Author",
      publisher: book.publisher,
      language: book.language,
      description: book.description,
      modified: book.lastOpened
        ? new Date(book.lastOpened).toISOString()
        : new Date(book.dateAdded).toISOString(),
    },
    links,
    images,
  };
}
