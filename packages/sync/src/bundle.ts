import {
  type SyncSnapshot,
  type SyncManifest,
  SYNC_SCHEMA_VERSION,
} from "./models.js";

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

  const manifest = JSON.parse(manifestStr) as SyncManifest;

  if (manifest.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported sync bundle schema version ${manifest.schemaVersion} (highest supported is ${SYNC_SCHEMA_VERSION})`,
    );
  }

  const parseJsonFile = <T>(name: string, fallback: T): T => {
    const raw = files[name];
    if (!raw) return fallback;
    const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    try {
      return JSON.parse(str) as T;
    } catch {
      return fallback;
    }
  };

  const books = parseJsonFile<SyncSnapshot["books"]>("library.json", []);
  const annotations = parseJsonFile<SyncSnapshot["annotations"]>(
    "annotations.json",
    [],
  );
  const readerState = parseJsonFile<{
    bookmarks?: SyncSnapshot["bookmarks"];
    readingPositions?: SyncSnapshot["readingPositions"];
  }>("reader-state.json", {});

  const tombstones = parseJsonFile<SyncSnapshot["tombstones"]>(
    "tombstones.json",
    [],
  );
  const conflicts = parseJsonFile<SyncSnapshot["conflicts"]>(
    "conflicts.json",
    [],
  );

  return {
    manifest,
    books,
    annotations,
    bookmarks: readerState.bookmarks ?? [],
    readingPositions: readerState.readingPositions ?? [],
    tombstones,
    conflicts,
  };
}
