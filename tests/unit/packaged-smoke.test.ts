import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { verifyPackagedArtifacts } from "../../scripts/smoke-test-package.js";

describe("Packaged Application Smoke Test", () => {
  it("verifies packaged artifacts structure if release-artifacts exists", () => {
    const artifactsDir = path.resolve(process.cwd(), "release-artifacts");
    if (!fs.existsSync(artifactsDir)) {
      // If not packaged in this run, test passes conditionally
      expect(true).toBe(true);
      return;
    }

    const result = verifyPackagedArtifacts(artifactsDir);
    expect(result.valid).toBe(true);
    expect(result.binarySize).toBeGreaterThan(10_000_000);
    expect(fs.existsSync(result.binaryPath)).toBe(true);
    expect(fs.existsSync(result.asarPath)).toBe(true);
  });
});
