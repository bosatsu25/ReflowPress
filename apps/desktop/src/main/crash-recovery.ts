import { readFile, writeFile, unlink, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

export interface ActiveSessionInfo {
  readonly pid: number;
  readonly startedAt: string;
  readonly lastActivePublication?: {
    readonly id: string;
    readonly filePath: string;
    readonly title?: string;
  };
  readonly lastView?: "library" | "reader";
  readonly lastUpdatedAt: string;
}

export interface CrashRecoveryStatus {
  readonly crashedLastSession: boolean;
  readonly lastActiveSession: ActiveSessionInfo | null;
  readonly cleanedTempFilesCount: number;
}

export const CLEAN_SHUTDOWN_MARKER_FILE = ".clean-shutdown";
export const ACTIVE_SESSION_FILE = ".active-session.json";

/**
 * Sweeps directory recursively or shallowly for orphaned .tmp-* files
 * left behind by interrupted atomic writes.
 */
export async function cleanupOrphanedTempFiles(dirPath: string): Promise<number> {
  let cleanedCount = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Only sweep direct cache subdirectories, avoid recursing into arbitrary deep dirs
        if (entry.name === "library-cache") {
          cleanedCount += await cleanupOrphanedTempFiles(fullPath);
        }
      } else if (entry.isFile()) {
        if (entry.name.includes(".tmp-") || entry.name.includes(".tmp.")) {
          try {
            await unlink(fullPath);
            cleanedCount++;
          } catch {
            // Best effort removal
          }
        }
      }
    }
  } catch {
    // If directory does not exist or cannot be read, ignore
  }
  return cleanedCount;
}

export class CrashRecoveryManager {
  private readonly userDataDir: string;
  private currentSession: ActiveSessionInfo;
  private recoveryStatus: CrashRecoveryStatus | null = null;

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir;
    this.currentSession = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  getRecoveryStatus(): CrashRecoveryStatus | null {
    return this.recoveryStatus;
  }

  clearRecoveryStatus(): void {
    this.recoveryStatus = null;
  }

  async checkCrashAndInitialize(): Promise<CrashRecoveryStatus> {
    await mkdir(this.userDataDir, { recursive: true });

    const cleanShutdownPath = path.join(this.userDataDir, CLEAN_SHUTDOWN_MARKER_FILE);
    const activeSessionPath = path.join(this.userDataDir, ACTIVE_SESSION_FILE);

    let cleanShutdownExists = false;
    try {
      await readFile(cleanShutdownPath, "utf8");
      cleanShutdownExists = true;
    } catch {
      cleanShutdownExists = false;
    }

    let priorSession: ActiveSessionInfo | null = null;
    try {
      const activeSessionRaw = await readFile(activeSessionPath, "utf8");
      priorSession = JSON.parse(activeSessionRaw) as ActiveSessionInfo;
    } catch {
      priorSession = null;
    }

    // A crash occurred if a prior active session was recorded but no clean shutdown marker was present
    const crashedLastSession = priorSession !== null && !cleanShutdownExists;

    // Prune stale clean-shutdown marker now that new session is running
    if (cleanShutdownExists) {
      try {
        await unlink(cleanShutdownPath);
      } catch {
        // Ignore
      }
    }

    // Clean up any orphaned temporary files
    const cleanedTempFilesCount = await cleanupOrphanedTempFiles(this.userDataDir);

    // Save initial active session for this process
    this.currentSession = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.persistActiveSession();

    this.recoveryStatus = {
      crashedLastSession,
      lastActiveSession: priorSession,
      cleanedTempFilesCount,
    };

    return this.recoveryStatus;
  }

  async updateActiveSession(update: Partial<ActiveSessionInfo>): Promise<void> {
    this.currentSession = {
      ...this.currentSession,
      ...update,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.persistActiveSession();
  }

  async recordCleanShutdown(): Promise<void> {
    const cleanShutdownPath = path.join(this.userDataDir, CLEAN_SHUTDOWN_MARKER_FILE);
    const activeSessionPath = path.join(this.userDataDir, ACTIVE_SESSION_FILE);

    const markerData = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    try {
      await writeFile(cleanShutdownPath, JSON.stringify(markerData, null, 2), "utf8");
      await unlink(activeSessionPath);
    } catch {
      // Best-effort shutdown recording
    }
  }

  private async persistActiveSession(): Promise<void> {
    const activeSessionPath = path.join(this.userDataDir, ACTIVE_SESSION_FILE);
    try {
      await writeFile(
        activeSessionPath,
        JSON.stringify(this.currentSession, null, 2),
        "utf8",
      );
    } catch {
      // Best-effort write
    }
  }
}
