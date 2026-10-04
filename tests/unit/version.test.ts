import { describe, it, expect } from "vitest";
import { checkVersionConsistency } from "../../scripts/check-version.js";
import { REFLOWPRESS_VERSION } from "../../packages/core/src/index.js";
import { CLI_VERSION } from "../../apps/cli/src/main.js";

describe("Canonical Version Consistency", () => {
  it("enforces strict version equality across all workspace packages and apps", () => {
    const result = checkVersionConsistency();
    expect(result.canonicalVersion).toBe(REFLOWPRESS_VERSION);
    expect(result.mismatches).toHaveLength(0);
    expect(result.checkedCount).toBeGreaterThanOrEqual(18);
  });

  it("ensures CLI_VERSION matches canonical REFLOWPRESS_VERSION", () => {
    expect(CLI_VERSION).toBe(REFLOWPRESS_VERSION);
  });
});
