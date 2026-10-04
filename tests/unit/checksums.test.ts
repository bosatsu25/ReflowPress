import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  generateChecksums,
  computeFileSha256,
} from "../../scripts/generate-checksums.js";

describe("SHA-256 Checksums Generator", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "reflowpress-checksums-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("computes deterministic SHA-256 for a given file", () => {
    const filePath = path.join(tempDir, "hello.txt");
    fs.writeFileSync(filePath, "ReflowPress Stable 1.0\n", "utf-8");

    const hash = computeFileSha256(filePath);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Re-computing hash returns identical digest
    expect(computeFileSha256(filePath)).toBe(hash);
  });

  it("generates formatted SHA256SUMS.txt ignoring metadata and YAML files", () => {
    fs.writeFileSync(
      path.join(tempDir, "ReflowPress-1.0.0.exe"),
      "binary1",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempDir, "ReflowPress-1.0.0.dmg"),
      "binary2",
      "utf-8",
    );
    fs.writeFileSync(path.join(tempDir, "builder-debug.yml"), "debug", "utf-8");
    fs.writeFileSync(path.join(tempDir, "latest.yml"), "latest", "utf-8");
    fs.writeFileSync(
      path.join(tempDir, "package.blockmap"),
      "blockmap",
      "utf-8",
    );

    const res = generateChecksums(tempDir);
    expect(res.count).toBe(2);
    expect(fs.existsSync(res.outputPath!)).toBe(true);

    const content = fs.readFileSync(res.outputPath!, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    expect(lines[0]).toContain("ReflowPress-1.0.0.dmg");
    expect(lines[1]).toContain("ReflowPress-1.0.0.exe");
    expect(lines[0]).toMatch(/^[a-f0-9]{64} {2}ReflowPress-1\.0\.0\.dmg$/);
  });
});
