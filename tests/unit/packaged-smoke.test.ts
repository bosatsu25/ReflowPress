import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  verifyPackagedArtifacts,
  assertPlatformArtifacts,
} from "../../scripts/smoke-test-package.js";

describe("Packaged Application Smoke Test", () => {
  it("verifies packaged artifacts structure if release-artifacts exists", () => {
    const artifactsDir = path.resolve(process.cwd(), "release-artifacts");
    if (!fs.existsSync(artifactsDir)) {
      expect(true).toBe(true);
      return;
    }

    const result = verifyPackagedArtifacts(artifactsDir);
    expect(result.valid).toBe(true);
    expect(result.binarySize).toBeGreaterThan(10_000_000);
    expect(fs.existsSync(result.binaryPath)).toBe(true);
    expect(fs.existsSync(result.asarPath)).toBe(true);
  });

  it("assertPlatformArtifacts validates platform-specific outputs correctly", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "reflowpress-smoke-artifact-test-"),
    );
    try {
      // Mock Windows artifacts (> 10MB)
      const bigBuffer = Buffer.alloc(10_500_000);
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-Setup-1.0.0.exe"),
        bigBuffer,
      );
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-1.0.0-portable.exe"),
        bigBuffer,
      );

      const winResult = assertPlatformArtifacts(tempDir, "win32");
      expect(winResult.valid).toBe(true);
      expect(winResult.artifacts).toHaveLength(2);

      // Fails when missing expected artifact for macOS
      expect(() => assertPlatformArtifacts(tempDir, "darwin")).toThrow(
        /Missing expected artifact for darwin/,
      );

      // Mock macOS artifacts
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-1.0.0-mac-x64.dmg"),
        bigBuffer,
      );
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-1.0.0-mac-x64.zip"),
        bigBuffer,
      );

      const macResult = assertPlatformArtifacts(tempDir, "darwin");
      expect(macResult.valid).toBe(true);
      expect(macResult.artifacts).toHaveLength(2);

      // Mock Linux artifacts
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-1.0.0-linux-x64.AppImage"),
        bigBuffer,
      );
      fs.writeFileSync(
        path.join(tempDir, "ReflowPress-1.0.0-linux-x64.deb"),
        bigBuffer,
      );

      const linuxResult = assertPlatformArtifacts(tempDir, "linux");
      expect(linuxResult.valid).toBe(true);
      expect(linuxResult.artifacts).toHaveLength(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
