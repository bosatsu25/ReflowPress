import {
  type SyncSnapshot,
  type RestorePlan,
  SYNC_SCHEMA_VERSION,
} from "./models.js";
import { mergeSnapshots } from "./merge.js";

export function createRestorePlan(
  bundle: SyncSnapshot,
  localCurrent: SyncSnapshot,
): RestorePlan {
  const validationErrors: string[] = [];

  if (!bundle.manifest) {
    validationErrors.push("Backup bundle is missing manifest.json");
  } else if (bundle.manifest.schemaVersion > SYNC_SCHEMA_VERSION) {
    validationErrors.push(
      `Unsupported backup schema version ${bundle.manifest.schemaVersion} (max supported: ${SYNC_SCHEMA_VERSION})`,
    );
  }

  if (validationErrors.length > 0) {
    return {
      schemaVersion: bundle.manifest?.schemaVersion ?? 0,
      isValid: false,
      validationErrors,
      toAdd: { books: 0, annotations: 0, bookmarks: 0, readingPositions: 0 },
      toUpdate: { books: 0, annotations: 0, bookmarks: 0, readingPositions: 0 },
      conflicts: [],
      unchanged: 0,
    };
  }

  // Preview by simulating merge
  const mergeResult = mergeSnapshots(null, localCurrent, bundle);

  // Calculate detailed additions/updates
  const countStats = <T extends { id: string }>(
    bundleList: readonly T[],
    localList: readonly T[],
  ): { add: number; update: number; unchanged: number } => {
    const localMap = new Map(localList.map((x) => [x.id, x]));
    let add = 0;
    let update = 0;
    let unchanged = 0;

    for (const item of bundleList) {
      const existing = localMap.get(item.id);
      if (!existing) {
        add++;
      } else if (JSON.stringify(existing) !== JSON.stringify(item)) {
        update++;
      } else {
        unchanged++;
      }
    }
    return { add, update, unchanged };
  };

  const bookStats = countStats(bundle.books, localCurrent.books);
  const annStats = countStats(bundle.annotations, localCurrent.annotations);
  const bmStats = countStats(bundle.bookmarks, localCurrent.bookmarks);
  const posStats = countStats(
    bundle.readingPositions,
    localCurrent.readingPositions,
  );

  return {
    schemaVersion: bundle.manifest.schemaVersion,
    isValid: true,
    validationErrors: [],
    toAdd: {
      books: bookStats.add,
      annotations: annStats.add,
      bookmarks: bmStats.add,
      readingPositions: posStats.add,
    },
    toUpdate: {
      books: bookStats.update,
      annotations: annStats.update,
      bookmarks: bmStats.update,
      readingPositions: posStats.update,
    },
    conflicts: mergeResult.newConflicts,
    unchanged:
      bookStats.unchanged +
      annStats.unchanged +
      bmStats.unchanged +
      posStats.unchanged,
  };
}

export function applyRestore(
  bundle: SyncSnapshot,
  localCurrent: SyncSnapshot,
  options: {
    conflictPolicy?: "keep-local" | "keep-remote" | "keep-both";
    installationId?: string;
  } = {},
): {
  restoredSnapshot: SyncSnapshot;
  resolvedConflicts: number;
} {
  const policy = options.conflictPolicy ?? "keep-local";
  const mergeResult = mergeSnapshots(null, localCurrent, bundle, {
    installationId: options.installationId ?? "restore-applied",
  });

  let snapshot = mergeResult.snapshot;
  let resolvedConflicts = 0;

  if (policy === "keep-remote" && mergeResult.newConflicts.length > 0) {
    // Override local conflicting items with remote
    const conflictIds = new Set(mergeResult.newConflicts.map((c) => c.id));
    const remoteBookMap = new Map(bundle.books.map((b) => [b.id, b]));
    const remoteAnnMap = new Map(bundle.annotations.map((a) => [a.id, a]));

    snapshot = {
      ...snapshot,
      books: snapshot.books.map((b) =>
        conflictIds.has(b.id) && remoteBookMap.has(b.id)
          ? remoteBookMap.get(b.id)!
          : b,
      ),
      annotations: snapshot.annotations.map((a) =>
        conflictIds.has(a.id) && remoteAnnMap.has(a.id)
          ? remoteAnnMap.get(a.id)!
          : a,
      ),
      conflicts: snapshot.conflicts.map((c) =>
        conflictIds.has(c.id)
          ? { ...c, resolved: true, resolutionChoice: "remote" as const }
          : c,
      ),
    };
    resolvedConflicts = mergeResult.newConflicts.length;
  } else if (policy === "keep-both") {
    // For books, clone remote version with a new ID
    const remoteBookMap = new Map(bundle.books.map((b) => [b.id, b]));
    const additionalBooks = mergeResult.newConflicts
      .filter((c) => c.recordType === "book" && remoteBookMap.has(c.id))
      .map((c) => {
        const remoteRecord = remoteBookMap.get(c.id)!;
        return {
          ...remoteRecord,
          id: `${remoteRecord.id}-remote-copy`,
          data: {
            ...remoteRecord.data,
            portableId: `${remoteRecord.data.portableId}-remote-copy`,
            title: `[Remote Copy] ${remoteRecord.data.title}`,
          },
        };
      });

    // For annotations, clone remote version with a new ID
    const remoteAnnMap = new Map(bundle.annotations.map((a) => [a.id, a]));
    const additionalAnns = mergeResult.newConflicts
      .filter((c) => c.recordType === "annotation" && remoteAnnMap.has(c.id))
      .map((c) => {
        const remoteRecord = remoteAnnMap.get(c.id)!;
        return {
          ...remoteRecord,
          id: `${remoteRecord.id}-remote-copy`,
          data: {
            ...remoteRecord.data,
            id: `${remoteRecord.data.id}-remote-copy`,
            note: remoteRecord.data.note
              ? `[Remote Copy] ${remoteRecord.data.note}`
              : undefined,
          },
        };
      });

    snapshot = {
      ...snapshot,
      books: [...snapshot.books, ...additionalBooks],
      annotations: [...snapshot.annotations, ...additionalAnns],
      conflicts: snapshot.conflicts.map((c) => ({
        ...c,
        resolved: true,
        resolutionChoice: "both" as const,
      })),
    };
    resolvedConflicts = mergeResult.newConflicts.length;
  }

  return {
    restoredSnapshot: snapshot,
    resolvedConflicts,
  };
}
