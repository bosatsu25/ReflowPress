import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CrashRecoveryManager,
  cleanupOrphanedTempFiles,
  CLEAN_SHUTDOWN_MARKER_FILE,
  ACTIVE_SESSION_FILE,
} from "../../apps/desktop/src/main/crash-recovery.js";

describe("Crash Recovery & Stable Runtime", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reflowpress-crash-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Clean Startup and Shutdown Lifecycle", () => {
    it("reports no crash on initial first launch", async () => {
      const manager = new CrashRecoveryManager(tempDir);
      const status = await manager.checkCrashAndInitialize();

      expect(status.crashedLastSession).toBe(false);
      expect(status.lastActiveSession).toBeNull();
      expect(status.cleanedTempFilesCount).toBe(0);

      // Verify active session file was written
      const activeContent = await fs.readFile(
        path.join(tempDir, ACTIVE_SESSION_FILE),
        "utf8",
      );
      const parsed = JSON.parse(activeContent);
      expect(parsed.pid).toBe(process.pid);
      expect(parsed.startedAt).toBeDefined();
    });

    it("writes clean-shutdown marker and removes active-session on clean exit", async () => {
      const manager = new CrashRecoveryManager(tempDir);
      await manager.checkCrashAndInitialize();
      await manager.recordCleanShutdown();

      // Clean shutdown marker should exist
      const markerContent = await fs.readFile(
        path.join(tempDir, CLEAN_SHUTDOWN_MARKER_FILE),
        "utf8",
      );
      expect(JSON.parse(markerContent).timestamp).toBeDefined();

      // Active session file should be unlinked
      await expect(
        fs.readFile(path.join(tempDir, ACTIVE_SESSION_FILE), "utf8"),
      ).rejects.toThrow();
    });

    it("detects clean previous shutdown on next run", async () => {
      const session1 = new CrashRecoveryManager(tempDir);
      await session1.checkCrashAndInitialize();
      await session1.recordCleanShutdown();

      const session2 = new CrashRecoveryManager(tempDir);
      const status = await session2.checkCrashAndInitialize();

      expect(status.crashedLastSession).toBe(false);
      expect(status.lastActiveSession).toBeNull();
    });
  });

  describe("Abnormal Termination & Workspace Recovery", () => {
    it("detects crash when active-session exists without clean-shutdown marker", async () => {
      const priorSessionData = {
        pid: 9999,
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        lastUpdatedAt: new Date(Date.now() - 1800000).toISOString(),
        lastActivePublication: {
          id: "urn:isbn:9781234567890",
          filePath: "/path/to/novel.epub",
          title: "The Great Adventure",
        },
        lastView: "reader",
      };

      await fs.writeFile(
        path.join(tempDir, ACTIVE_SESSION_FILE),
        JSON.stringify(priorSessionData),
        "utf8",
      );

      const manager = new CrashRecoveryManager(tempDir);
      const status = await manager.checkCrashAndInitialize();

      expect(status.crashedLastSession).toBe(true);
      expect(status.lastActiveSession).toEqual(priorSessionData);
      expect(manager.getRecoveryStatus()?.crashedLastSession).toBe(true);

      manager.clearRecoveryStatus();
      expect(manager.getRecoveryStatus()).toBeNull();
    });

    it("updates active session with publication and view state", async () => {
      const manager = new CrashRecoveryManager(tempDir);
      await manager.checkCrashAndInitialize();

      await manager.updateActiveSession({
        lastActivePublication: {
          id: "pub-42",
          filePath: "/docs/sample.epub",
          title: "Sample Book",
        },
        lastView: "reader",
      });

      const content = await fs.readFile(
        path.join(tempDir, ACTIVE_SESSION_FILE),
        "utf8",
      );
      const parsed = JSON.parse(content);
      expect(parsed.lastActivePublication?.title).toBe("Sample Book");
      expect(parsed.lastView).toBe("reader");
    });
  });

  describe("Temporary Artifact Janitor", () => {
    it("sweeps and removes orphaned .tmp-* and .tmp.* files left behind by interrupted writes", async () => {
      // Create some persistent files
      await fs.writeFile(path.join(tempDir, "library-v1.json"), "{}", "utf8");
      await fs.writeFile(path.join(tempDir, "reader-state.json"), "{}", "utf8");

      // Create some orphaned temporary files
      await fs.writeFile(
        path.join(tempDir, "library-v1.json.tmp-1791075500"),
        "{ partial...",
        "utf8",
      );
      await fs.writeFile(
        path.join(tempDir, "annotations.tmp.12345"),
        "{ unclosed...",
        "utf8",
      );

      // Create a cache subdir with a tmp file
      const cacheDir = path.join(tempDir, "library-cache");
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(
        path.join(cacheDir, "cover-1.png.tmp-abc"),
        "png",
        "utf8",
      );
      await fs.writeFile(
        path.join(cacheDir, "cover-1.png"),
        "valid png",
        "utf8",
      );

      const cleaned = await cleanupOrphanedTempFiles(tempDir);
      expect(cleaned).toBe(3);

      // Verify persistent files were untouched
      expect(
        await fs.readFile(path.join(tempDir, "library-v1.json"), "utf8"),
      ).toBe("{}");
      expect(
        await fs.readFile(path.join(tempDir, "reader-state.json"), "utf8"),
      ).toBe("{}");
      expect(
        await fs.readFile(path.join(cacheDir, "cover-1.png"), "utf8"),
      ).toBe("valid png");

      // Verify temporary files are deleted
      const rootFiles = await fs.readdir(tempDir);
      expect(rootFiles.some((f) => f.includes(".tmp"))).toBe(false);

      const cacheFiles = await fs.readdir(cacheDir);
      expect(cacheFiles.some((f) => f.includes(".tmp"))).toBe(false);
    });
  });
});
