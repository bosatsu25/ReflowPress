import type {
  SyncRecord,
  SyncSnapshot,
  MergeResult,
  ConflictRecord,
  TombstoneRecord,
} from "./models.js";

/**
 * Tombstones dated further ahead than this are ignored: a bundle from another
 * machine could otherwise delete records permanently by claiming a deletion
 * far in the future that no later edit can ever outrank.
 */
export const MAX_TOMBSTONE_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function tombstoneKey(recordType: string, id: string): string {
  return `${recordType}:${id}`;
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function mergeSnapshots(
  baseSnapshot: SyncSnapshot | null,
  localSnapshot: SyncSnapshot,
  remoteSnapshot: SyncSnapshot,
  options: { installationId: string } = { installationId: "local" },
): MergeResult {
  const newConflicts: ConflictRecord[] = [];
  let appliedRemoteChanges = 0;
  let preservedLocalChanges = 0;
  let tombstonesApplied = 0;

  // Tombstones are keyed by record type as well as id, so deleting a
  // bookmark cannot take out a book that happens to share its id.
  const latestAllowedDeletion = Date.now() + MAX_TOMBSTONE_CLOCK_SKEW_MS;
  const usable = (t: TombstoneRecord) =>
    timeOf(t.deletedAt) <= latestAllowedDeletion;

  const localTombstones = new Map<string, TombstoneRecord>();
  for (const t of localSnapshot.tombstones) {
    if (usable(t)) localTombstones.set(tombstoneKey(t.recordType, t.id), t);
  }

  const remoteTombstones = new Map<string, TombstoneRecord>();
  for (const t of remoteSnapshot.tombstones) {
    if (usable(t)) remoteTombstones.set(tombstoneKey(t.recordType, t.id), t);
  }

  // Helper to merge a generic sync collection
  function mergeCollection<T>(
    recordType: ConflictRecord["recordType"],
    baseRecords: readonly SyncRecord<T>[],
    localRecords: readonly SyncRecord<T>[],
    remoteRecords: readonly SyncRecord<T>[],
  ): readonly SyncRecord<T>[] {
    const baseMap = new Map<string, SyncRecord<T>>();
    for (const r of baseRecords) baseMap.set(r.id, r);

    const localMap = new Map<string, SyncRecord<T>>();
    for (const r of localRecords) localMap.set(r.id, r);

    const remoteMap = new Map<string, SyncRecord<T>>();
    for (const r of remoteRecords) remoteMap.set(r.id, r);

    const mergedMap = new Map<string, SyncRecord<T>>();
    const allIds = new Set<string>([
      ...localMap.keys(),
      ...remoteMap.keys(),
      ...baseMap.keys(),
    ]);

    for (const id of allIds) {
      const local = localMap.get(id);
      const remote = remoteMap.get(id);
      const base = baseMap.get(id);
      const localTomb = localTombstones.get(tombstoneKey(recordType, id));
      const remoteTomb = remoteTombstones.get(tombstoneKey(recordType, id));

      // Check remote deletion
      if (remoteTomb && !localTomb) {
        if (!local || timeOf(local.updatedAt) <= timeOf(remoteTomb.deletedAt)) {
          // Clean remote deletion applied locally
          tombstonesApplied++;
          continue;
        } else {
          // Local modified after remote deletion -> CONFLICT
          newConflicts.push({
            id,
            recordType,
            detectedAt: new Date().toISOString(),
            base: base?.data,
            local: local.data,
            remote: undefined as unknown as T,
          });
          mergedMap.set(id, local);
          continue;
        }
      }

      // Check local deletion
      if (localTomb && !remoteTomb) {
        if (
          !remote ||
          timeOf(remote.updatedAt) <= timeOf(localTomb.deletedAt)
        ) {
          // Local deletion preserved
          continue;
        } else {
          // Remote modified after local deletion -> CONFLICT
          newConflicts.push({
            id,
            recordType,
            detectedAt: new Date().toISOString(),
            base: base?.data,
            local: undefined as unknown as T,
            remote: remote.data,
          });
          mergedMap.set(id, remote);
          continue;
        }
      }

      // Both deleted
      if (localTomb && remoteTomb) {
        continue;
      }

      // Case 1: Exists in both local and remote
      if (local && remote) {
        if (local.rev === remote.rev) {
          // Identical
          mergedMap.set(id, local);
        } else if (base && local.rev === base.rev && remote.rev !== base.rev) {
          // Only remote changed -> accept remote
          mergedMap.set(id, remote);
          appliedRemoteChanges++;
        } else if (base && remote.rev === base.rev && local.rev !== base.rev) {
          // Only local changed -> preserve local
          mergedMap.set(id, local);
          preservedLocalChanges++;
        } else {
          // Both changed or no base -> CONFLICT
          newConflicts.push({
            id,
            recordType,
            detectedAt: new Date().toISOString(),
            base: base?.data,
            local: local.data,
            remote: remote.data,
          });
          // Preserve local version in working set while recording conflict
          mergedMap.set(id, local);
        }
        continue;
      }

      // Case 2: Only in local
      if (local && !remote) {
        if (base && !remoteTomb) {
          // Remote deleted without tombstone
          // Treat as remote delete if local was unchanged, else conflict
          if (local.rev === base.rev) {
            tombstonesApplied++;
          } else {
            newConflicts.push({
              id,
              recordType,
              detectedAt: new Date().toISOString(),
              base: base.data,
              local: local.data,
              remote: undefined as unknown as T,
            });
            mergedMap.set(id, local);
          }
        } else {
          // Local addition -> preserve
          mergedMap.set(id, local);
          preservedLocalChanges++;
        }
        continue;
      }

      // Case 3: Only in remote
      if (remote && !local) {
        if (base && !localTomb) {
          // Local deleted without tombstone
          if (remote.rev === base.rev) {
            // Both agree on deletion
          } else {
            newConflicts.push({
              id,
              recordType,
              detectedAt: new Date().toISOString(),
              base: base.data,
              local: undefined as unknown as T,
              remote: remote.data,
            });
            mergedMap.set(id, remote);
          }
        } else {
          // Remote addition -> adopt
          mergedMap.set(id, remote);
          appliedRemoteChanges++;
        }
        continue;
      }
    }

    return Array.from(mergedMap.values());
  }

  const mergedBooks = mergeCollection(
    "book",
    baseSnapshot?.books ?? [],
    localSnapshot.books,
    remoteSnapshot.books,
  );

  const mergedAnnotations = mergeCollection(
    "annotation",
    baseSnapshot?.annotations ?? [],
    localSnapshot.annotations,
    remoteSnapshot.annotations,
  );

  const mergedBookmarks = mergeCollection(
    "bookmark",
    baseSnapshot?.bookmarks ?? [],
    localSnapshot.bookmarks,
    remoteSnapshot.bookmarks,
  );

  const mergedPositions = mergeCollection(
    "readingPosition",
    baseSnapshot?.readingPositions ?? [],
    localSnapshot.readingPositions,
    remoteSnapshot.readingPositions,
  );

  // Union tombstones; future-dated ones are dropped rather than propagated.
  const allTombstonesMap = new Map<string, TombstoneRecord>(localTombstones);
  for (const [key, t] of remoteTombstones) {
    const existing = allTombstonesMap.get(key);
    if (!existing || timeOf(t.deletedAt) > timeOf(existing.deletedAt)) {
      allTombstonesMap.set(key, t);
    }
  }

  // Combine conflicts: existing unresolved + newly detected
  const existingConflictsMap = new Map<string, ConflictRecord>();
  for (const c of localSnapshot.conflicts) existingConflictsMap.set(c.id, c);
  for (const c of remoteSnapshot.conflicts) {
    if (!existingConflictsMap.has(c.id)) existingConflictsMap.set(c.id, c);
  }
  for (const c of newConflicts) {
    existingConflictsMap.set(c.id, c);
  }

  const allConflicts = Array.from(existingConflictsMap.values());
  const allTombstones = Array.from(allTombstonesMap.values());

  const mergedSnapshot: SyncSnapshot = {
    manifest: {
      schemaVersion: 1,
      bundleId: localSnapshot.manifest.bundleId || `bundle-${Date.now()}`,
      createdAt: localSnapshot.manifest.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceInstallationId: options.installationId,
      counts: {
        books: mergedBooks.length,
        annotations: mergedAnnotations.length,
        bookmarks: mergedBookmarks.length,
        readingPositions: mergedPositions.length,
        tombstones: allTombstones.length,
        conflicts: allConflicts.length,
      },
    },
    books: mergedBooks,
    annotations: mergedAnnotations,
    bookmarks: mergedBookmarks,
    readingPositions: mergedPositions,
    tombstones: allTombstones,
    conflicts: allConflicts,
  };

  return {
    snapshot: mergedSnapshot,
    newConflicts,
    appliedRemoteChanges,
    preservedLocalChanges,
    tombstonesApplied,
  };
}
