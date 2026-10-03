/**
 * Portable Sync and Interoperability Data Models
 */

export const SYNC_SCHEMA_VERSION = 1;

export type PortablePublicationId = string;

export interface SyncRecord<T> {
  readonly id: string;
  readonly rev: string; // Deterministic content hash or revision
  readonly updatedAt: string; // ISO 8601
  readonly installationId: string; // Random installation UUID (non-PII)
  readonly data: T;
}

export interface TombstoneRecord {
  readonly id: string;
  readonly recordType:
    "book" | "annotation" | "bookmark" | "readingPosition" | "collection";
  readonly deletedAt: string; // ISO 8601
  readonly rev: string;
  readonly installationId: string;
}

export interface ConflictRecord<T = unknown> {
  readonly id: string;
  readonly recordType:
    "book" | "annotation" | "bookmark" | "readingPosition" | "collection";
  readonly detectedAt: string; // ISO 8601
  readonly base?: T | undefined;
  readonly local: T;
  readonly remote: T;
  readonly resolved?: boolean | undefined;
  readonly resolutionChoice?: "local" | "remote" | "both" | undefined;
}

export interface SyncManifest {
  readonly schemaVersion: number;
  readonly bundleId: string;
  readonly createdAt: string; // ISO 8601
  readonly updatedAt: string; // ISO 8601
  readonly sourceInstallationId: string;
  readonly counts: {
    readonly books: number;
    readonly annotations: number;
    readonly bookmarks: number;
    readonly readingPositions: number;
    readonly tombstones: number;
    readonly conflicts: number;
  };
}

export interface SyncLibraryBookData {
  readonly portableId: PortablePublicationId;
  readonly title: string;
  readonly author?: string | undefined;
  readonly format: "epub" | "pdf";
  readonly metadata?: Record<string, unknown> | undefined;
  readonly collections?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface SyncAnnotationData {
  readonly id: string;
  readonly portablePublicationId: PortablePublicationId;
  readonly type: "highlight" | "note";
  readonly color?: string | undefined;
  readonly text?: string | undefined;
  readonly note?: string | undefined;
  readonly locator: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SyncBookmarkData {
  readonly id: string;
  readonly portablePublicationId: PortablePublicationId;
  readonly title: string;
  readonly locator: unknown;
  readonly createdAt: string;
}

export interface SyncReadingPositionData {
  readonly portablePublicationId: PortablePublicationId;
  readonly sectionHref?: string | undefined;
  readonly progressPercent?: number | undefined;
  readonly pdfPage?: number | undefined;
  readonly updatedAt: string;
}

export interface SyncSnapshot {
  readonly manifest: SyncManifest;
  readonly books: readonly SyncRecord<SyncLibraryBookData>[];
  readonly annotations: readonly SyncRecord<SyncAnnotationData>[];
  readonly bookmarks: readonly SyncRecord<SyncBookmarkData>[];
  readonly readingPositions: readonly SyncRecord<SyncReadingPositionData>[];
  readonly tombstones: readonly TombstoneRecord[];
  readonly conflicts: readonly ConflictRecord[];
}

export interface MergeResult {
  readonly snapshot: SyncSnapshot;
  readonly newConflicts: readonly ConflictRecord[];
  readonly appliedRemoteChanges: number;
  readonly preservedLocalChanges: number;
  readonly tombstonesApplied: number;
}

export interface RestorePlan {
  readonly schemaVersion: number;
  readonly isValid: boolean;
  readonly validationErrors: readonly string[];
  readonly toAdd: {
    readonly books: number;
    readonly annotations: number;
    readonly bookmarks: number;
    readonly readingPositions: number;
  };
  readonly toUpdate: {
    readonly books: number;
    readonly annotations: number;
    readonly bookmarks: number;
    readonly readingPositions: number;
  };
  readonly conflicts: readonly ConflictRecord[];
  readonly unchanged: number;
}
