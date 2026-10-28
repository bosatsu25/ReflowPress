import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import {
  verifyPackagedArtifacts,
  assertPlatformArtifacts,
} from "../../scripts/smoke-test-package.js";

const require = createRequire(import.meta.url);
const asar = require(
  require.resolve("@electron/asar", {
    paths: [require.resolve("electron-builder")],
  }),
) as { createPackage(src: string, dest: string): Promise<void> };

/** Lays out a macOS app bundle shaped like electron-builder's `mac/` output. */
async function createMacBundle(
  targetDir: string,
  frameworkSize: number,
): Promise<void> {
  const contentsDir = path.join(
    targetDir,
    "mac",
    "ReflowPress.app",
    "Contents",
  );
  const frameworkDir = path.join(
    contentsDir,
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
  );
  fs.mkdirSync(path.join(contentsDir, "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(contentsDir, "Resources"), { recursive: true });
  fs.mkdirSync(frameworkDir, { recursive: true });

  // The real launcher stub on CI was 17,176 bytes.
  fs.writeFileSync(
    path.join(contentsDir, "MacOS", "ReflowPress"),
    Buffer.alloc(17_176, 1),
  );
  fs.writeFileSync(
    path.join(frameworkDir, "Electron Framework"),
    Buffer.alloc(frameworkSize, 1),
  );

  const appDir = path.join(targetDir, "app-src");
  for (const entry of [
    "package.json",
    "apps/desktop/dist/main/main.js",
    "apps/desktop/dist/preload/preload.cjs",
    "apps/desktop/dist/renderer/index.html",
  ]) {
    fs.mkdirSync(path.dirname(path.join(appDir, entry)), { recursive: true });
    fs.writeFileSync(path.join(appDir, entry), "{}");
  }
  await asar.createPackage(
    appDir,
    path.join(contentsDir, "Resources", "app.asar"),
  );
}

describe("Packaged Application Smoke Test", () => {
  it("verifies packaged artifacts structure if release-artifacts exists", () => {
    const artifactsDir = path.resolve(process.cwd(), "release-artifacts");
    if (!fs.existsSync(artifactsDir)) {
      expect(true).toBe(true);
      return;
    }

    const result = verifyPackagedArtifacts(artifactsDir);
    expect(result.valid).toBe(true);
    expect(result.runtimeSize).toBeGreaterThan(10_000_000);
    expect(fs.existsSync(result.binaryPath)).toBe(true);
    expect(fs.existsSync(result.asarPath)).toBe(true);
  });

  it("accepts the small macOS launcher stub and checks the Electron Framework instead", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "reflowpress-smoke-mac-test-"),
    );
    try {
      await createMacBundle(tempDir, 10_500_000);

      const result = verifyPackagedArtifacts(tempDir, "darwin");
      expect(result.valid).toBe(true);
      expect(result.binarySize).toBe(17_176);
      expect(result.runtimePath).toContain("Electron Framework.framework");
      expect(result.runtimeSize).toBeGreaterThan(10_000_000);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a macOS bundle whose Electron Framework is truncated", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "reflowpress-smoke-mac-test-"),
    );
    try {
      await createMacBundle(tempDir, 1_024);

      expect(() => verifyPackagedArtifacts(tempDir, "darwin")).toThrow(
        /Electron runtime appears truncated/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
