import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FolderSyncAdapter,
  deserializeSyncBundle,
  serializeSyncBundle,
  mergeSnapshots,
  syncRecordsToCatalogBooks,
  type SyncSnapshot,
  type TombstoneRecord,
} from "../../packages/sync/src/index.js";
import {
  FilesystemDeviceAdapter,
  KNOWN_PROFILES,
  type DeviceDescriptor,
} from "../../packages/device/src/index.js";
import { parseNcxDocument } from "../../packages/epub/src/navigation.js";
import { stripTerminalControls } from "../../apps/cli/src/main.js";
import { DOMParser } from "@xmldom/xmldom";

function snapshot(partial: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    manifest: {
      schemaVersion: 1,
      bundleId: "bundle",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      sourceInstallationId: "node-a",
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
    ...partial,
  };
}

const book = {
  id: "shared-id",
  rev: "rev-1",
  updatedAt: "2026-10-01T00:00:00.000Z",
  installationId: "node-a",
  data: { portableId: "p1", title: "Kept", format: "epub" as const },
};

let workDir = "";

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), "reflowpress-harden-"));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("FolderSyncAdapter locking", () => {
  it("refuses a fresh lock held by someone else", async () => {
    const first = new FolderSyncAdapter({ syncFolderPath: workDir });
    const second = new FolderSyncAdapter({ syncFolderPath: workDir });
    await first.acquireLock();
    await expect(second.acquireLock()).rejects.toThrow(/locked/);
    await first.releaseLock();
    await expect(second.acquireLock()).resolves.toBeUndefined();
    await second.releaseLock();
  });

  it("never releases a lock another process took over", async () => {
    const adapter = new FolderSyncAdapter({ syncFolderPath: workDir });
    await adapter.acquireLock();

    // Another machine broke our (expired) lease and holds the folder now.
    const lockFile = path.join(workDir, ".sync.lock");
    await fs.writeFile(lockFile, JSON.stringify({ token: "someone-else" }));

    await expect(adapter.writeSnapshot(snapshot())).rejects.toThrow(
      /Lost the sync folder lock/,
    );
    await adapter.releaseLock();
    expect(JSON.parse(await fs.readFile(lockFile, "utf-8"))).toEqual({
      token: "someone-else",
    });
    await expect(
      fs.access(path.join(workDir, "manifest.json")),
    ).rejects.toThrow();
  });

  it("breaks an expired lock and writes with a renewed lease", async () => {
    const lockFile = path.join(workDir, ".sync.lock");
    await fs.writeFile(lockFile, JSON.stringify({ token: "abandoned" }));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockFile, old, old);

    const adapter = new FolderSyncAdapter({
      syncFolderPath: workDir,
      lockTimeoutMs: 1_000,
    });
    await adapter.acquireLock();
    await adapter.writeSnapshot(snapshot({ books: [book] }));
    const leaseAge = Date.now() - (await fs.stat(lockFile)).mtimeMs;
    expect(leaseAge).toBeLessThan(1_000);
    await adapter.releaseLock();
    await expect(fs.access(lockFile)).rejects.toThrow();
    expect((await adapter.readSnapshot())?.books).toHaveLength(1);
  });

  it("reads only bundle files, and refuses links and oversized entries", async () => {
    const adapter = new FolderSyncAdapter({ syncFolderPath: workDir });
    const files = serializeSyncBundle(snapshot({ books: [book] }));
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(workDir, name), content);
    }
    // Unrelated JSON in the folder is not read at all.
    await fs.writeFile(path.join(workDir, "huge-unrelated.json"), "{");
    expect((await adapter.readSnapshot())?.books).toHaveLength(1);

    const outside = path.join(workDir, "..", `outside-${Date.now()}.json`);
    await fs.writeFile(outside, "[]");
    try {
      await fs.rm(path.join(workDir, "library.json"));
      await fs.symlink(outside, path.join(workDir, "library.json"));
      await expect(adapter.readSnapshot()).rejects.toThrow(
        /not a regular file/,
      );
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});

describe("sync bundle validation", () => {
  it("drops malformed records and rebuilds valid ones from known fields", () => {
    const files = serializeSyncBundle(snapshot());
    const result = deserializeSyncBundle({
      ...files,
      "library.json": JSON.stringify([
        {
          ...book,
          data: { ...book.data, extra: "<script>", filePath: "C:\\x" },
        },
        { ...book, id: "", rev: "r" },
        { ...book, id: "bad-date", updatedAt: "yesterday" },
        { ...book, id: "bad-format", data: { ...book.data, format: "exe" } },
        { ...book, id: "bad-tags", data: { ...book.data, tags: "a,b" } },
        "not an object",
      ]),
      "tombstones.json": JSON.stringify([
        {
          id: "x",
          recordType: "everything",
          deletedAt: "2026-10-01T00:00:00Z",
          rev: "r",
          installationId: "i",
        },
      ]),
      "reader-state.json": JSON.stringify({
        readingPositions: [
          {
            ...book,
            data: {
              portablePublicationId: "p1",
              progressPercent: 1e9,
              updatedAt: "2026-10-01T00:00:00Z",
            },
          },
        ],
      }),
    });

    expect(result.books).toHaveLength(1);
    expect(result.books[0]?.data).toEqual(book.data);
    expect(result.tombstones).toEqual([]);
    expect(result.readingPositions).toEqual([]);
  });

  it("rejects a manifest with a non-integer schema version", () => {
    const files = serializeSyncBundle(snapshot());
    const manifest = JSON.parse(files["manifest.json"]) as Record<
      string,
      unknown
    >;
    expect(() =>
      deserializeSyncBundle({
        ...files,
        "manifest.json": JSON.stringify({ ...manifest, schemaVersion: "1" }),
      }),
    ).toThrow(/malformed manifest/);
  });
});

describe("tombstone merging", () => {
  const tombstone = (
    recordType: TombstoneRecord["recordType"],
    deletedAt: string,
  ): TombstoneRecord => ({
    id: "shared-id",
    recordType,
    deletedAt,
    rev: "tomb",
    installationId: "node-b",
  });

  it("does not let a bookmark deletion remove a book with the same id", () => {
    const result = mergeSnapshots(
      snapshot({ books: [book] }),
      snapshot({ books: [book] }),
      snapshot({
        books: [book],
        tombstones: [tombstone("bookmark", "2026-10-02T00:00:00.000Z")],
      }),
    );
    expect(result.snapshot.books.map((b) => b.id)).toEqual(["shared-id"]);
  });

  it("ignores tombstones dated far in the future", () => {
    const result = mergeSnapshots(
      snapshot({ books: [book] }),
      snapshot({ books: [book] }),
      snapshot({
        books: [book],
        tombstones: [tombstone("book", "2999-01-01T00:00:00.000Z")],
      }),
    );
    expect(result.snapshot.books).toHaveLength(1);
    expect(result.snapshot.tombstones).toEqual([]);
  });

  it("still applies a genuine remote deletion", () => {
    const result = mergeSnapshots(
      snapshot({ books: [book] }),
      snapshot({ books: [book] }),
      snapshot({
        tombstones: [tombstone("book", "2026-10-02T00:00:00.000Z")],
      }),
    );
    expect(result.snapshot.books).toEqual([]);
    expect(result.tombstonesApplied).toBe(1);
  });
});

describe("restoring into an existing catalog", () => {
  it("keeps the file path of books already in the library", () => {
    const [restored] = syncRecordsToCatalogBooks(
      [book],
      [
        {
          id: "shared-id",
          title: "Old title",
          format: "epub",
          filePath: "/books/kept.epub",
          fileSizeBytes: 10,
          modifiedTimeMs: 1,
          dateAdded: "2026-10-01T00:00:00.000Z",
          tags: [],
          collectionIds: [],
          availability: { exists: true, lastChecked: "2026-10-01T00:00:00Z" },
        },
      ],
    );
    expect(restored?.filePath).toBe("/books/kept.epub");
    expect(restored?.title).toBe("Kept");
  });
});

describe("FilesystemDeviceAdapter containment", () => {
  let deviceRoot = "";
  let source = "";

  const device = (profile = KNOWN_PROFILES.generic): DeviceDescriptor => ({
    id: "dev",
    name: "Device",
    type: "filesystem",
    mountPoint: deviceRoot,
    isAvailable: true,
    profile,
  });

  beforeEach(async () => {
    deviceRoot = path.join(workDir, "device");
    await fs.mkdir(deviceRoot);
    source = path.join(workDir, "source.epub");
    await fs.writeFile(source, "epub-bytes");
  });

  const item = (targetFilename: string) => ({
    sourcePath: source,
    targetFilename,
    format: "epub" as const,
    byteSize: 10,
  });

  it("accepts names that merely contain two dots", async () => {
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    const plan = await adapter.createTransferPlan(
      [item("Vol..2.epub")],
      device(),
    );
    expect(plan.items[0]?.status).toBe("copy");
  });

  it("rejects separators and dot segments", async () => {
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    for (const name of ["../escape.epub", "a/b.epub", "a\\b.epub", "..", ""]) {
      await expect(
        adapter.createTransferPlan([item(name)], device()),
      ).rejects.toThrow(/Path traversal/);
    }
  });

  it("refuses a books folder that links off the device", async () => {
    const elsewhere = path.join(workDir, "elsewhere");
    await fs.mkdir(elsewhere);
    await fs.symlink(elsewhere, path.join(deviceRoot, "Books"), "dir");
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    await expect(
      adapter.createTransferPlan(
        [item("book.epub")],
        device(KNOWN_PROFILES.pocketbook),
      ),
    ).rejects.toThrow(/escapes device root/);
  });

  it("treats a planted link at the target name as a conflict", async () => {
    await fs.symlink(
      path.join(workDir, "victim.txt"),
      path.join(deviceRoot, "book.epub"),
    );
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    const plan = await adapter.createTransferPlan(
      [item("book.epub")],
      device(),
    );
    expect(plan.items[0]?.status).toBe("conflict");
    const result = await adapter.executeTransfer(plan);
    expect(result.successful).toBe(0);
    await expect(fs.access(path.join(workDir, "victim.txt"))).rejects.toThrow();
  });

  it("does not overwrite a file that appears after planning", async () => {
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    const plan = await adapter.createTransferPlan(
      [item("book.epub")],
      device(),
    );
    await fs.writeFile(path.join(deviceRoot, "book.epub"), "user's own file");

    const result = await adapter.executeTransfer(plan);
    expect(result.failed).toBe(1);
    expect(await fs.readFile(path.join(deviceRoot, "book.epub"), "utf-8")).toBe(
      "user's own file",
    );
    const leftovers = (await fs.readdir(deviceRoot)).filter((n) =>
      n.startsWith(".tmp-transfer-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("re-checks plan targets before writing", async () => {
    const adapter = new FilesystemDeviceAdapter(deviceRoot);
    const plan = await adapter.createTransferPlan(
      [item("book.epub")],
      device(),
    );
    const tampered = {
      ...plan,
      items: [
        { ...plan.items[0]!, targetPath: path.join(workDir, "out.epub") },
      ],
    };
    const result = await adapter.executeTransfer(tampered);
    expect(result.failed).toBe(1);
    await expect(fs.access(path.join(workDir, "out.epub"))).rejects.toThrow();
  });
});

describe("untrusted text handling", () => {
  it("strips terminal escape sequences from CLI output", () => {
    expect(stripTerminalControls("Title\u001b]0;pwned\u0007\u009b2J\n")).toBe(
      "Title]0;pwned2J\n",
    );
  });

  it("keeps a book with a malformed escape in its table of contents", () => {
    const ncx = new DOMParser().parseFromString(
      `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
        <navPoint id="a"><navLabel><text>Bad</text></navLabel><content src="ch%E0%A4%A.xhtml"/></navPoint>
        <navPoint id="b"><navLabel><text>Good</text></navLabel><content src="ch%201.xhtml"/></navPoint>
      </navMap></ncx>`,
      "application/xml",
    );
    const items = parseNcxDocument(ncx, "OEBPS/toc.ncx", (m) => new Error(m));
    expect(items.map((i) => i.href)).toEqual([
      "OEBPS/ch%E0%A4%A.xhtml",
      "OEBPS/ch 1.xhtml",
    ]);
  });
});
