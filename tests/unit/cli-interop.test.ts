import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, EXIT_CODES } from "../../apps/cli/src/main.js";

describe("CLI Interoperability Subcommands", () => {
  let tempDir: string;
  let stdoutMessages: string[] = [];
  let stderrMessages: string[] = [];

  const mockIo = {
    stdout: (m: string) => stdoutMessages.push(m),
    stderr: (m: string) => stderrMessages.push(m),
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reflowpress-cli-interop-"),
    );
    stdoutMessages = [];
    stderrMessages = [];
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("handles 'opds serve' and stops cleanly when signal aborts", async () => {
    const controller = new AbortController();
    const catalogPath = path.join(tempDir, "catalog.json");
    await fs.writeFile(
      catalogPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-10-01",
        collections: [],
        books: [],
      }),
      "utf-8",
    );

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);

    const code = await runCli(
      ["opds", "serve", "--port", "0", "--catalog", catalogPath],
      { ...mockIo, signal: controller.signal },
    );

    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(
      stdoutMessages.some((m) => m.includes("OPDS 2.0 Server running")),
    ).toBe(true);
  });

  it("handles 'sync folder' with --dry-run option", async () => {
    const syncDir = path.join(tempDir, "sync-target");
    await fs.mkdir(syncDir, { recursive: true });

    const code = await runCli(
      ["sync", "folder", "--target", syncDir, "--dry-run"],
      mockIo,
    );
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutMessages.some((m) => m.includes("(dry-run)"))).toBe(true);
  });

  it("rejects 'sync webdav' without password environment variable", async () => {
    const oldEnv = process.env.REFLOWPRESS_WEBDAV_PASSWORD;
    delete process.env.REFLOWPRESS_WEBDAV_PASSWORD;

    try {
      const code = await runCli(
        ["sync", "webdav", "--url", "https://example.com/webdav/"],
        mockIo,
      );
      expect(code).toBe(EXIT_CODES.FATAL_ERROR);
      expect(
        stderrMessages.some((m) => m.includes("REFLOWPRESS_WEBDAV_PASSWORD")),
      ).toBe(true);
    } finally {
      if (oldEnv) process.env.REFLOWPRESS_WEBDAV_PASSWORD = oldEnv;
    }
  });

  it("handles 'backup' to write a sync bundle", async () => {
    const backupFile = path.join(tempDir, "backup.json");
    const code = await runCli(["backup", "--output", backupFile], mockIo);
    expect(code).toBe(EXIT_CODES.SUCCESS);

    const exists = await fs
      .stat(backupFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    const content = JSON.parse(await fs.readFile(backupFile, "utf-8"));
    expect(content["manifest.json"]).toBeDefined();
  });

  it("handles 'restore --preview' on an existing backup bundle", async () => {
    const backupFile = path.join(tempDir, "backup.json");
    await runCli(["backup", "--output", backupFile], mockIo);

    stdoutMessages = [];
    const code = await runCli(["restore", backupFile, "--preview"], mockIo);
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutMessages.some((m) => m.includes("Restore Preview"))).toBe(
      true,
    );
  });

  it("handles 'device list' detecting current directory profile", async () => {
    const code = await runCli(["device", "list", "--target", tempDir], mockIo);
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutMessages.some((m) => m.includes("Device detected"))).toBe(
      true,
    );
  });
});
