import { UpgradeRequiredError } from "@reflowpress/core";
import { type SyncSnapshot, SYNC_SCHEMA_VERSION } from "./models.js";
import {
  validateAnnotations,
  validateBookmarks,
  validateBooks,
  validateConflicts,
  validateManifest,
  validateReadingPositions,
  validateTombstones,
} from "./validate.js";

export interface SerializedBundleFiles {
  readonly "manifest.json": string;
  readonly "library.json": string;
  readonly "annotations.json": string;
  readonly "reader-state.json": string;
  readonly "tombstones.json": string;
  readonly "conflicts.json": string;
  readonly [filename: string]: string;
}

export function serializeSyncBundle(
  snapshot: SyncSnapshot,
): SerializedBundleFiles {
  return {
    "manifest.json": JSON.stringify(snapshot.manifest, null, 2),
    "library.json": JSON.stringify(snapshot.books, null, 2),
    "annotations.json": JSON.stringify(snapshot.annotations, null, 2),
    "reader-state.json": JSON.stringify(
      {
        bookmarks: snapshot.bookmarks,
        readingPositions: snapshot.readingPositions,
      },
      null,
      2,
    ),
    "tombstones.json": JSON.stringify(snapshot.tombstones, null, 2),
    "conflicts.json": JSON.stringify(snapshot.conflicts, null, 2),
  };
}

export function deserializeSyncBundle(
  files: Record<string, string | Uint8Array>,
): SyncSnapshot {
  // Path traversal check on all entries
  for (const key of Object.keys(files)) {
    if (
      key.includes("..") ||
      key.startsWith("/") ||
      key.startsWith("\\") ||
      /^[a-zA-Z]:/.test(key)
    ) {
      throw new Error(
        `Path traversal attempt detected in bundle entry: '${key}'`,
      );
    }
  }

  const manifestContent = files["manifest.json"];
  if (!manifestContent) {
    throw new Error("Invalid sync bundle: missing 'manifest.json'");
  }

  const manifestStr =
    typeof manifestContent === "string"
      ? manifestContent
      : new TextDecoder().decode(manifestContent);

  const rawManifest = JSON.parse(manifestStr) as unknown;

  // A newer app may have changed the manifest's shape, so the version is
  // checked before anything else to report "upgrade required" accurately.
  const declaredVersion =
    typeof rawManifest === "object" && rawManifest !== null
      ? (rawManifest as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (
    typeof declaredVersion === "number" &&
    declaredVersion > SYNC_SCHEMA_VERSION
  ) {
    throw new UpgradeRequiredError(
      "Sync Bundle",
      SYNC_SCHEMA_VERSION,
      declaredVersion,
    );
  }

  const manifest = validateManifest(rawManifest);

  const parseJsonFile = (name: string): unknown => {
    const raw = files[name];
    if (!raw) return undefined;
    const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    try {
      return JSON.parse(str) as unknown;
    } catch {
      return undefined;
    }
  };

  // Every collection is validated record by record; malformed records are
  // dropped rather than trusted.
  const books = validateBooks(parseJsonFile("library.json"));
  const annotations = validateAnnotations(parseJsonFile("annotations.json"));
  const readerState = parseJsonFile("reader-state.json");
  const readerStateObject =
    typeof readerState === "object" && readerState !== null
      ? (readerState as Record<string, unknown>)
      : {};
  const tombstones = validateTombstones(parseJsonFile("tombstones.json"));
  const conflicts = validateConflicts(parseJsonFile("conflicts.json"));

  return {
    manifest,
    books,
    annotations,
    bookmarks: validateBookmarks(readerStateObject.bookmarks),
    readingPositions: validateReadingPositions(
      readerStateObject.readingPositions,
    ),
    tombstones,
    conflicts,
  };
}
