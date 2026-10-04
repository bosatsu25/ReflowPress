import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  computePortablePublicationId,
  mergeSnapshots,
  FolderSyncAdapter,
  DEFAULT_SYNC_LOCK_TIMEOUT_MS,
  serializeSyncBundle,
  deserializeSyncBundle,
  createRestorePlan,
  applyRestore,
  type SyncSnapshot,
} from "../../packages/sync/src/index.js";

describe("Sync Engine & Data Portability (@reflowpress/sync)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reflowpress-sync-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("computePortablePublicationId", () => {
    it("produces deterministic machine-independent ID", () => {
      const id1 = computePortablePublicationId({
        title: "Kokoro",
        author: "Natsume Soseki",
        format: "epub",
      });
      const id2 = computePortablePublicationId({
        title: "Kokoro",
        author: "Natsume Soseki",
        format: "epub",
      });
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^fp-[a-f0-9]{24}$/);
    });

    it("normalizes case and whitespace in title and author", () => {
      const id1 = computePortablePublicationId({
        title: "  kokoro  ",
        author: "Natsume Soseki",
      });
      const id2 = computePortablePublicationId({
        title: "Kokoro",
        author: "natsume soseki",
      });
      expect(id1).toBe(id2);
    });
  });

  describe("mergeSnapshots (3-Way Merge)", () => {
    const emptySnapshot = (installationId: string): SyncSnapshot => ({
      manifest: {
        schemaVersion: 1,
        bundleId: `bundle-${installationId}`,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        sourceInstallationId: installationId,
        counts: {
          books: 0,
          annotations: 0,
          bookmarks: 0,
          readingPositions: 0,
          tombstones: 0,
          conflicts: 0,
        },
      },
      books: [],
      annotations: [],
      bookmarks: [],
      readingPositions: [],
      tombstones: [],
      conflicts: [],
    });

    it("applies remote additions while preserving local items", () => {
      const local: SyncSnapshot = {
        ...emptySnapshot("local"),
        books: [
          {
            id: "b1",
            rev: "rev-1",
            updatedAt: "2026-10-01T10:00:00.000Z",
            installationId: "local",
            data: { portableId: "p1", title: "Local Book", format: "epub" },
          },
        ],
      };

      const remote: SyncSnapshot = {
        ...emptySnapshot("remote"),
        books: [
          {
            id: "b2",
            rev: "rev-1",
            updatedAt: "2026-10-01T11:00:00.000Z",
            installationId: "remote",
            data: { portableId: "p2", title: "Remote Book", format: "epub" },
          },
        ],
      };

      const result = mergeSnapshots(null, local, remote);
      expect(result.snapshot.books).toHaveLength(2);
      expect(result.appliedRemoteChanges).toBe(1);
      expect(result.newConflicts).toHaveLength(0);
    });

    it("detects concurrent conflicting updates and records ConflictRecord without silent loss", () => {
      const base: SyncSnapshot = {
        ...emptySnapshot("base"),
        books: [
          {
            id: "b1",
            rev: "rev-0",
            updatedAt: "2026-10-01T09:00:00.000Z",
            installationId: "base",
            data: { portableId: "p1", title: "Original Title", format: "epub" },
          },
        ],
      };

      const local: SyncSnapshot = {
        ...emptySnapshot("local"),
        books: [
          {
            id: "b1",
            rev: "rev-local",
            updatedAt: "2026-10-01T10:00:00.000Z",
            installationId: "local",
            data: {
              portableId: "p1",
              title: "Local Edited Title",
              format: "epub",
            },
          },
        ],
      };

      const remote: SyncSnapshot = {
        ...emptySnapshot("remote"),
        books: [
          {
            id: "b1",
            rev: "rev-remote",
            updatedAt: "2026-10-01T11:00:00.000Z",
            installationId: "remote",
            data: {
              portableId: "p1",
              title: "Remote Edited Title",
              format: "epub",
            },
          },
        ],
      };

      const result = mergeSnapshots(base, local, remote);
      expect(result.newConflicts).toHaveLength(1);
      const conflict = result.newConflicts[0]!;
      expect(conflict.id).toBe("b1");
      expect(conflict.recordType).toBe("book");
      expect(conflict.local).toEqual(local.books[0]?.data);
      expect(conflict.remote).toEqual(remote.books[0]?.data);
      expect(conflict.base).toEqual(base.books[0]?.data);
    });

    it("applies remote deletion via tombstone when local has not been updated since deletion", () => {
      const local: SyncSnapshot = {
        ...emptySnapshot("local"),
        books: [
          {
            id: "b1",
            rev: "rev-1",
            updatedAt: "2026-10-01T08:00:00.000Z",
            installationId: "local",
            data: { portableId: "p1", title: "Old Book", format: "epub" },
          },
        ],
      };

      const remote: SyncSnapshot = {
        ...emptySnapshot("remote"),
        books: [],
        tombstones: [
          {
            id: "b1",
            recordType: "book",
            deletedAt: "2026-10-01T09:00:00.000Z",
            rev: "rev-del",
            installationId: "remote",
          },
        ],
      };

      const result = mergeSnapshots(null, local, remote);
      expect(result.snapshot.books).toHaveLength(0);
      expect(result.tombstonesApplied).toBe(1);
    });
  });

  describe("Sync Bundle Serialization", () => {
    it("serializes and deserializes snapshot roundtrip cleanly", () => {
      const snapshot: SyncSnapshot = {
        manifest: {
          schemaVersion: 1,
          bundleId: "bundle-roundtrip",
          createdAt: "2026-10-01T12:00:00.000Z",
          updatedAt: "2026-10-01T12:00:00.000Z",
          sourceInstallationId: "test-node",
          counts: {
            books: 1,
            annotations: 0,
            bookmarks: 0,
            readingPositions: 0,
            tombstones: 0,
            conflicts: 0,
          },
        },
        books: [
          {
            id: "b1",
            rev: "rev-1",
            updatedAt: "2026-10-01T12:00:00.000Z",
            installationId: "test-node",
            data: { portableId: "p1", title: "Book One", format: "epub" },
          },
        ],
        annotations: [],
        bookmarks: [],
        readingPositions: [],
        tombstones: [],
        conflicts: [],
      };

      const serialized = serializeSyncBundle(snapshot);
      expect(serialized["manifest.json"]).toBeDefined();
      expect(serialized["library.json"]).toBeDefined();

      const deserialized = deserializeSyncBundle(serialized);
      expect(deserialized.manifest.bundleId).toBe("bundle-roundtrip");
      expect(deserialized.books).toHaveLength(1);
      expect(deserialized.books[0]?.data.title).toBe("Book One");
    });
  });

  describe("FolderSyncAdapter", () => {
    it("defines default lock timeout of 15 minutes", () => {
      expect(DEFAULT_SYNC_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
    });

    it("writes and reads snapshot bundle atomically", async () => {
      const adapter = new FolderSyncAdapter({ syncFolderPath: tempDir });
      const snapshot: SyncSnapshot = {
        manifest: {
          schemaVersion: 1,
          bundleId: "test-bundle",
          createdAt: "2026-10-01T12:00:00.000Z",
          updatedAt: "2026-10-01T12:00:00.000Z",
          sourceInstallationId: "node-1",
          counts: {
            books: 1,
            annotations: 0,
            bookmarks: 0,
            readingPositions: 0,
            tombstones: 0,
            conflicts: 0,
          },
        },
        books: [
          {
            id: "book-1",
            rev: "rev-1",
            updatedAt: "2026-10-01T12:00:00.000Z",
            installationId: "node-1",
            data: { portableId: "p1", title: "Synced Title", format: "epub" },
          },
        ],
        annotations: [],
        bookmarks: [],
        readingPositions: [],
        tombstones: [],
        conflicts: [],
      };

      await adapter.acquireLock();
      await adapter.writeSnapshot(snapshot);
      await adapter.releaseLock();

      const readBack = await adapter.readSnapshot();
      expect(readBack).not.toBeNull();
      expect(readBack?.manifest.bundleId).toBe("test-bundle");
      expect(readBack?.books).toHaveLength(1);
      expect(readBack?.books[0]?.data.title).toBe("Synced Title");
    });

    it("recovers from stale lock files older than lockTimeoutMs", async () => {
      const lockFile = path.join(tempDir, ".sync.lock");
      // Write a lock file with older timestamp
      await fs.writeFile(
        lockFile,
        JSON.stringify({ pid: 9999, createdAt: "2020-01-01" }),
        "utf-8",
      );

      // Set mtime to 2 hours ago
      const oldTime = new Date(Date.now() - 7200 * 1000);
      await fs.utimes(lockFile, oldTime, oldTime);

      const adapter = new FolderSyncAdapter({
        syncFolderPath: tempDir,
        lockTimeoutMs: 1000,
      });
      // Should successfully acquire and recover
      await expect(adapter.acquireLock()).resolves.toBeUndefined();
      await adapter.releaseLock();
    });
  });

  describe("RestorePlan & ApplyRestore", () => {
    const bundle: SyncSnapshot = {
      manifest: {
        schemaVersion: 1,
        bundleId: "bundle-backup",
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-01T12:00:00.000Z",
        sourceInstallationId: "backup",
        counts: {
          books: 2,
          annotations: 0,
          bookmarks: 0,
          readingPositions: 0,
          tombstones: 0,
          conflicts: 0,
        },
      },
      books: [
        {
          id: "b1",
          rev: "rev-1",
          updatedAt: "2026-10-01T10:00:00.000Z",
          installationId: "backup",
          data: { portableId: "p1", title: "Book One", format: "epub" },
        },
        {
          id: "b2",
          rev: "rev-1",
          updatedAt: "2026-10-01T10:00:00.000Z",
          installationId: "backup",
          data: { portableId: "p2", title: "Book Two", format: "epub" },
        },
      ],
      annotations: [],
      bookmarks: [],
      readingPositions: [],
      tombstones: [],
      conflicts: [],
    };

    const localCurrent: SyncSnapshot = {
      manifest: {
        schemaVersion: 1,
        bundleId: "bundle-local",
        createdAt: "2026-10-01T12:00:00.000Z",
        updatedAt: "2026-10-01T12:00:00.000Z",
        sourceInstallationId: "local",
        counts: {
          books: 1,
          annotations: 0,
          bookmarks: 0,
          readingPositions: 0,
          tombstones: 0,
          conflicts: 0,
        },
      },
      books: [
        {
          id: "b1",
          rev: "rev-2",
          updatedAt: "2026-10-01T11:00:00.000Z",
          installationId: "local",
          data: {
            portableId: "p1",
            title: "Book One (Modified Locally)",
            format: "epub",
          },
        },
      ],
      annotations: [],
      bookmarks: [],
      readingPositions: [],
      tombstones: [],
      conflicts: [],
    };

    it("previews additions and conflicts correctly", () => {
      const plan = createRestorePlan(bundle, localCurrent);
      expect(plan.isValid).toBe(true);
      expect(plan.toAdd.books).toBe(1); // b2 is new
      expect(plan.conflicts).toHaveLength(1); // b1 modified concurrently
    });

    it("applies restore with keep-local policy", () => {
      const { restoredSnapshot, resolvedConflicts } = applyRestore(
        bundle,
        localCurrent,
        {
          conflictPolicy: "keep-local",
        },
      );
      expect(resolvedConflicts).toBe(0);
      const b1 = restoredSnapshot.books.find((b) => b.id === "b1");
      expect(b1?.data.title).toBe("Book One (Modified Locally)");
      expect(restoredSnapshot.books).toHaveLength(2);
    });

    it("applies restore with keep-remote policy", () => {
      const { restoredSnapshot, resolvedConflicts } = applyRestore(
        bundle,
        localCurrent,
        {
          conflictPolicy: "keep-remote",
        },
      );
      expect(resolvedConflicts).toBe(1);
      const b1 = restoredSnapshot.books.find((b) => b.id === "b1");
      expect(b1?.data.title).toBe("Book One");
      expect(restoredSnapshot.books).toHaveLength(2);
    });

    it("applies restore with keep-both policy preserving both items", () => {
      const { restoredSnapshot, resolvedConflicts } = applyRestore(
        bundle,
        localCurrent,
        {
          conflictPolicy: "keep-both",
        },
      );
      expect(resolvedConflicts).toBe(1);
      expect(restoredSnapshot.books.length).toBeGreaterThanOrEqual(3);
    });
  });
});
