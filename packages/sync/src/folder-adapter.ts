import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SyncSnapshot } from "./models.js";
import { serializeSyncBundle, deserializeSyncBundle } from "./bundle.js";

export const DEFAULT_SYNC_LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Largest single bundle file read from a sync folder. */
export const MAX_SYNC_BUNDLE_FILE_BYTES = 32 * 1024 * 1024;

const LOCK_FILE = ".sync.lock";

/** The files a sync bundle consists of; nothing else in the folder is read. */
const BUNDLE_FILES = [
  "manifest.json",
  "library.json",
  "annotations.json",
  "reader-state.json",
  "tombstones.json",
  "conflicts.json",
] as const;

export interface FolderSyncAdapterOptions {
  readonly syncFolderPath: string;
  readonly lockTimeoutMs?: number | undefined;
}

export class FolderSyncLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderSyncLockError";
  }
}

export class FolderSyncAdapter {
  private readonly folderPath: string;
  private readonly lockTimeoutMs: number;
  /** Random token written into the lock file while this adapter holds it. */
  private lockToken: string | null = null;

  constructor(options: FolderSyncAdapterOptions) {
    this.folderPath = path.resolve(options.syncFolderPath);
    this.lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_SYNC_LOCK_TIMEOUT_MS;
  }

  private get lockFile(): string {
    return path.join(this.folderPath, LOCK_FILE);
  }

  public async acquireLock(): Promise<void> {
    await fs.mkdir(this.folderPath, { recursive: true });
    const token = randomUUID();
    const lockData = JSON.stringify({
      token,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fs.writeFile(this.lockFile, lockData, { flag: "wx" });
        this.lockToken = token;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      await this.breakStaleLock();
    }
    throw new FolderSyncLockError("Sync folder is locked by another process.");
  }

  /**
   * Removes the lock file only if its lease has expired. Another machine may
   * break the same stale lock and take a fresh one in between, so the lock is
   * first moved aside atomically and put back if it turns out to be fresh.
   */
  private async breakStaleLock(): Promise<void> {
    let ageMs: number;
    try {
      ageMs = Date.now() - (await fs.lstat(this.lockFile)).mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    if (ageMs <= this.lockTimeoutMs) {
      throw new FolderSyncLockError(
        `Sync folder is locked by another process (lease expires in ${Math.round((this.lockTimeoutMs - ageMs) / 1000)}s).`,
      );
    }

    const aside = path.join(
      this.folderPath,
      `${LOCK_FILE}.stale-${randomUUID()}`,
    );
    try {
      await fs.rename(this.lockFile, aside);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const movedAge = Date.now() - (await fs.lstat(aside)).mtimeMs;
    if (movedAge <= this.lockTimeoutMs) {
      // We moved someone else's fresh lock. Put it back unless yet another
      // process has created one meanwhile, then report the folder as busy.
      await fs.link(aside, this.lockFile).catch(() => {});
      await fs.unlink(aside).catch(() => {});
      throw new FolderSyncLockError(
        "Sync folder is locked by another process.",
      );
    }
    await fs.unlink(aside).catch(() => {});
  }

  /** Whether the lock file still carries this adapter's token. */
  private async ownsLock(): Promise<boolean> {
    if (!this.lockToken) return false;
    try {
      const raw = await fs.readFile(this.lockFile, "utf-8");
      const parsed = JSON.parse(raw) as { token?: unknown };
      return parsed.token === this.lockToken;
    } catch {
      return false;
    }
  }

  public async releaseLock(): Promise<void> {
    if (!this.lockToken) return;
    // Never remove a lock another process took after ours expired.
    if (await this.ownsLock()) {
      await fs.unlink(this.lockFile).catch(() => {});
    }
    this.lockToken = null;
  }

  /**
   * Confirms the lock is still ours and renews its lease, so a long write is
   * not mistaken for an abandoned one.
   */
  private async renewLease(): Promise<void> {
    if (!this.lockToken) return;
    if (!(await this.ownsLock())) {
      this.lockToken = null;
      throw new FolderSyncLockError(
        "Lost the sync folder lock to another process; nothing was written.",
      );
    }
    const now = new Date();
    await fs.utimes(this.lockFile, now, now);
  }

  public async readSnapshot(): Promise<SyncSnapshot | null> {
    const files: Record<string, string> = {};

    for (const name of BUNDLE_FILES) {
      const content = await readBundleFile(path.join(this.folderPath, name));
      if (content !== null) files[name] = content;
    }

    if (files["manifest.json"] === undefined) {
      // No sync bundle exists in folder yet
      return null;
    }
    return deserializeSyncBundle(files);
  }

  public async writeSnapshot(snapshot: SyncSnapshot): Promise<void> {
    await this.renewLease();
    const tempDir = path.join(this.folderPath, `.tmp-sync-${randomUUID()}`);

    await fs.mkdir(tempDir);

    try {
      const files = serializeSyncBundle(snapshot);

      for (const [filename, content] of Object.entries(files)) {
        const tempFile = path.join(tempDir, filename);
        await fs.writeFile(tempFile, content, {
          encoding: "utf-8",
          flag: "wx",
        });
      }

      await this.renewLease();

      // Move files into sync folder
      for (const filename of Object.keys(files)) {
        const tempFile = path.join(tempDir, filename);
        const destFile = path.join(this.folderPath, filename);
        await fs.rename(tempFile, destFile);
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Reads one bundle file, refusing anything that is not a regular file or is
 * larger than the cap. Returns null when the file does not exist.
 */
async function readBundleFile(filePath: string): Promise<string | null> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isFile()) {
    throw new Error(
      `Sync bundle entry '${path.basename(filePath)}' is not a regular file.`,
    );
  }
  if (stat.size > MAX_SYNC_BUNDLE_FILE_BYTES) {
    throw new Error(
      `Sync bundle entry '${path.basename(filePath)}' is too large (${stat.size} bytes; limit ${MAX_SYNC_BUNDLE_FILE_BYTES}).`,
    );
  }
  return fs.readFile(filePath, "utf-8");
}
