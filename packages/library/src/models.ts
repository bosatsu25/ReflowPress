export type PublicationFormat = "epub" | "pdf";

export interface BookAvailability {
  exists: boolean;
  lastChecked: string;
  fileSizeBytes?: number | undefined;
  lastModified?: string | undefined;
}

export interface BookReadingProgress {
  location?: string | undefined;
  percentage?: number | undefined;
  updatedAt: string;
}

export interface LibraryBook {
  id: string; // SHA-256 of canonical path
  filePath: string;
  format: PublicationFormat;
  title: string;
  creator?: string | undefined;
  publisher?: string | undefined;
  language?: string | undefined;
  description?: string | undefined;
  identifier?: string | undefined;
  dateAdded: string; // ISO 8601
  lastOpened?: string | undefined; // ISO 8601
  fileSizeBytes: number;
  modifiedTimeMs: number;
  coverPath?: string | undefined;
  tags: string[];
  collectionIds: string[];
  readingProgress?: BookReadingProgress | undefined;
  availability: BookAvailability;
}

export interface LibraryCollection {
  id: string;
  name: string;
  description?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCatalog {
  schemaVersion: number;
  updatedAt: string;
  books: LibraryBook[];
  collections: LibraryCollection[];
  scanPaths: string[];
}

export type BookSortField = "title" | "creator" | "dateAdded" | "lastOpened";
export type SortDirection = "asc" | "desc";

export interface BookSortCriteria {
  field: BookSortField;
  direction: SortDirection;
}

export interface BookFilterCriteria {
  query?: string | undefined;
  format?: PublicationFormat | "all" | undefined;
  collectionId?: string | undefined;
  tag?: string | undefined;
}

export interface ScanResult {
  added: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: Array<{ filePath: string; message: string }>;
}
