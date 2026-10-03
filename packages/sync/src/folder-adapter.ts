import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SyncSnapshot } from "./models.js";
import { serializeSyncBundle, deserializeSyncBundle } from "./bundle.js";

export interface FolderSyncAdapterOptions {
  readonly syncFolderPath: string;
  readonly lockTimeoutMs?: number | undefined;
}

export class FolderSyncAdapter {
  private readonly folderPath: string;
  private readonly lockTimeoutMs: number;
  private lockAcquired = false;

  constructor(options: FolderSyncAdapterOptions) {
    this.folderPath = path.resolve(options.syncFolderPath);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
  }

  public async acquireLock(): Promise<void> {
    const lockFile = path.join(this.folderPath, ".sync.lock");
    const now = Date.now();

    await fs.mkdir(this.folderPath, { recursive: true });

    try {
      const stat = await fs.stat(lockFile);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > this.lockTimeoutMs) {
        // Stale lock recovery
        await fs.unlink(lockFile).catch(() => {});
      } else {
        throw new Error(
          `Sync folder is locked by another process (lease expires in ${Math.round((this.lockTimeoutMs - ageMs) / 1000)}s).`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    const lockData = JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    });

    await fs.writeFile(lockFile, lockData, { flag: "wx" });
    this.lockAcquired = true;
  }

  public async releaseLock(): Promise<void> {
    if (!this.lockAcquired) return;
    const lockFile = path.join(this.folderPath, ".sync.lock");
    await fs.unlink(lockFile).catch(() => {});
    this.lockAcquired = false;
  }

  public async readSnapshot(): Promise<SyncSnapshot | null> {
    const manifestPath = path.join(this.folderPath, "manifest.json");
    try {
      await fs.stat(manifestPath);
    } catch {
      // No sync bundle exists in folder yet
      return null;
    }

    const entries = await fs.readdir(this.folderPath, { withFileTypes: true });
    const files: Record<string, string> = {};

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const fullPath = path.join(this.folderPath, entry.name);
        const content = await fs.readFile(fullPath, "utf-8");
        files[entry.name] = content;
      }
    }

    return deserializeSyncBundle(files);
  }

  public async writeSnapshot(snapshot: SyncSnapshot): Promise<void> {
    const tempDir = path.join(
      this.folderPath,
      `.tmp-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    await fs.mkdir(tempDir, { recursive: true });

    try {
      const files = serializeSyncBundle(snapshot);

      for (const [filename, content] of Object.entries(files)) {
        const tempFile = path.join(tempDir, filename);
        await fs.writeFile(tempFile, content, "utf-8");
      }

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
