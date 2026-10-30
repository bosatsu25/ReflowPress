import type {
  ConflictRecord,
  SyncAnnotationData,
  SyncBookmarkData,
  SyncLibraryBookData,
  SyncManifest,
  SyncReadingPositionData,
  SyncRecord,
  TombstoneRecord,
} from "./models.js";

/**
 * Validation for sync bundles read from shared folders, WebDAV servers and
 * backup files. Those come from other machines, so every record is checked
 * field by field and rebuilt from the validated values; anything that does
 * not fit the model is dropped instead of reaching the catalog.
 */

const MAX_ID_LENGTH = 512;
const MAX_TEXT_LENGTH = 64 * 1024;
const MAX_LIST_LENGTH = 1_000;
export const MAX_SYNC_RECORDS_PER_COLLECTION = 100_000;

const RECORD_TYPES = new Set<TombstoneRecord["recordType"]>([
  "book",
  "annotation",
  "bookmark",
  "readingPosition",
  "collection",
]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isText(value) ? value : null;
}

function stringList(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > MAX_LIST_LENGTH ||
    !value.every(isId)
  ) {
    return null;
  }
  return [...value];
}

function recordEnvelope(raw: unknown): {
  id: string;
  rev: string;
  updatedAt: string;
  installationId: string;
  data: Json;
} | null {
  if (!isObject(raw)) return null;
  const { id, rev, updatedAt, installationId, data } = raw;
  if (
    !isId(id) ||
    !isId(rev) ||
    !isIsoTimestamp(updatedAt) ||
    !isId(installationId) ||
    !isObject(data)
  ) {
    return null;
  }
  return { id, rev, updatedAt, installationId, data };
}

function bookRecord(raw: unknown): SyncRecord<SyncLibraryBookData> | null {
  const env = recordEnvelope(raw);
  if (!env) return null;
  const { portableId, title, author, format, collections, tags, metadata } =
    env.data;
  const checkedAuthor = optionalText(author);
  const checkedCollections = stringList(collections);
  const checkedTags = stringList(tags);
  if (
    !isId(portableId) ||
    !isText(title) ||
    checkedAuthor === null ||
    (format !== "epub" && format !== "pdf") ||
    checkedCollections === null ||
    checkedTags === null ||
    (metadata !== undefined && !isObject(metadata))
  ) {
    return null;
  }
  return {
    ...env,
    data: {
      portableId,
      title,
      format,
      ...(checkedAuthor !== undefined ? { author: checkedAuthor } : {}),
      ...(checkedCollections !== undefined
        ? { collections: checkedCollections }
        : {}),
      ...(checkedTags !== undefined ? { tags: checkedTags } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  };
}

function annotationRecord(raw: unknown): SyncRecord<SyncAnnotationData> | null {
  const env = recordEnvelope(raw);
  if (!env) return null;
  const d = env.data;
  const color = optionalText(d.color);
  const text = optionalText(d.text);
  const note = optionalText(d.note);
  if (
    !isId(d.id) ||
    !isId(d.portablePublicationId) ||
    (d.type !== "highlight" && d.type !== "note") ||
    color === null ||
    text === null ||
    note === null ||
    !isObject(d.locator) ||
    !isIsoTimestamp(d.createdAt) ||
    !isIsoTimestamp(d.updatedAt)
  ) {
    return null;
  }
  return {
    ...env,
    data: {
      id: d.id,
      portablePublicationId: d.portablePublicationId,
      type: d.type,
      locator: d.locator,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      ...(color !== undefined ? { color } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

function bookmarkRecord(raw: unknown): SyncRecord<SyncBookmarkData> | null {
  const env = recordEnvelope(raw);
  if (!env) return null;
  const d = env.data;
  if (
    !isId(d.id) ||
    !isId(d.portablePublicationId) ||
    !isText(d.title) ||
    !isObject(d.locator) ||
    !isIsoTimestamp(d.createdAt)
  ) {
    return null;
  }
  return {
    ...env,
    data: {
      id: d.id,
      portablePublicationId: d.portablePublicationId,
      title: d.title,
      locator: d.locator,
      createdAt: d.createdAt,
    },
  };
}

function readingPositionRecord(
  raw: unknown,
): SyncRecord<SyncReadingPositionData> | null {
  const env = recordEnvelope(raw);
  if (!env) return null;
  const d = env.data;
  const sectionHref = optionalText(d.sectionHref);
  const progressOk =
    d.progressPercent === undefined ||
    (typeof d.progressPercent === "number" &&
      Number.isFinite(d.progressPercent) &&
      d.progressPercent >= 0 &&
      d.progressPercent <= 100);
  const pageOk =
    d.pdfPage === undefined ||
    (typeof d.pdfPage === "number" &&
      Number.isInteger(d.pdfPage) &&
      d.pdfPage >= 1);
  if (
    !isId(d.portablePublicationId) ||
    sectionHref === null ||
    !progressOk ||
    !pageOk ||
    !isIsoTimestamp(d.updatedAt)
  ) {
    return null;
  }
  return {
    ...env,
    data: {
      portablePublicationId: d.portablePublicationId,
      updatedAt: d.updatedAt,
      ...(sectionHref !== undefined ? { sectionHref } : {}),
      ...(d.progressPercent !== undefined
        ? { progressPercent: d.progressPercent as number }
        : {}),
      ...(d.pdfPage !== undefined ? { pdfPage: d.pdfPage as number } : {}),
    },
  };
}

function tombstoneRecord(raw: unknown): TombstoneRecord | null {
  if (!isObject(raw)) return null;
  const { id, recordType, deletedAt, rev, installationId } = raw;
  if (
    !isId(id) ||
    !RECORD_TYPES.has(recordType as TombstoneRecord["recordType"]) ||
    !isIsoTimestamp(deletedAt) ||
    !isId(rev) ||
    !isId(installationId)
  ) {
    return null;
  }
  return {
    id,
    recordType: recordType as TombstoneRecord["recordType"],
    deletedAt,
    rev,
    installationId,
  };
}

function conflictRecord(raw: unknown): ConflictRecord | null {
  if (!isObject(raw)) return null;
  const { id, recordType, detectedAt, base, local, remote, resolved } = raw;
  const choice = raw.resolutionChoice;
  if (
    !isId(id) ||
    !RECORD_TYPES.has(recordType as ConflictRecord["recordType"]) ||
    !isIsoTimestamp(detectedAt) ||
    (resolved !== undefined && typeof resolved !== "boolean") ||
    (choice !== undefined &&
      choice !== "local" &&
      choice !== "remote" &&
      choice !== "both")
  ) {
    return null;
  }
  return {
    id,
    recordType: recordType as ConflictRecord["recordType"],
    detectedAt,
    local,
    remote,
    ...(base !== undefined ? { base } : {}),
    ...(resolved !== undefined ? { resolved } : {}),
    ...(choice !== undefined
      ? { resolutionChoice: choice as "local" | "remote" | "both" }
      : {}),
  };
}

function validList<T>(
  raw: unknown,
  validate: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw.slice(0, MAX_SYNC_RECORDS_PER_COLLECTION)) {
    const valid = validate(item);
    if (valid) out.push(valid);
  }
  return out;
}

export function validateManifest(raw: unknown): SyncManifest {
  if (!isObject(raw)) {
    throw new Error("Invalid sync bundle: manifest is not an object.");
  }
  const {
    schemaVersion,
    bundleId,
    createdAt,
    updatedAt,
    sourceInstallationId,
    counts,
  } = raw;
  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    !isId(bundleId) ||
    !isIsoTimestamp(createdAt) ||
    !isIsoTimestamp(updatedAt) ||
    !isId(sourceInstallationId)
  ) {
    throw new Error("Invalid sync bundle: malformed manifest.");
  }
  const count = (key: string): number => {
    const value = isObject(counts) ? counts[key] : undefined;
    return typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  };
  return {
    schemaVersion,
    bundleId,
    createdAt,
    updatedAt,
    sourceInstallationId,
    counts: {
      books: count("books"),
      annotations: count("annotations"),
      bookmarks: count("bookmarks"),
      readingPositions: count("readingPositions"),
      tombstones: count("tombstones"),
      conflicts: count("conflicts"),
    },
  };
}

export const validateBooks = (raw: unknown) => validList(raw, bookRecord);
export const validateAnnotations = (raw: unknown) =>
  validList(raw, annotationRecord);
export const validateBookmarks = (raw: unknown) =>
  validList(raw, bookmarkRecord);
export const validateReadingPositions = (raw: unknown) =>
  validList(raw, readingPositionRecord);
export const validateTombstones = (raw: unknown) =>
  validList(raw, tombstoneRecord);
export const validateConflicts = (raw: unknown) =>
  validList(raw, conflictRecord);
