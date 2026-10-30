import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Cross-Platform Packaging Configuration (electron-builder.yml)", () => {
  const configPath = path.resolve(__dirname, "../../electron-builder.yml");

  it("defines standard application metadata and output directories", async () => {
    const yaml = await fs.readFile(configPath, "utf8");

    expect(yaml).toContain("appId: org.reflowpress.desktop");
    expect(yaml).toContain("productName: ReflowPress");
    expect(yaml).toContain("output: release-artifacts");
  });

  it("declares the distributed OS targets: Windows and Linux only", async () => {
    const yaml = await fs.readFile(configPath, "utf8");

    // macOS is not distributed in 1.0.
    expect(yaml).not.toMatch(/^mac:/m);

    // Windows: nsis + portable, x64
    expect(yaml).toContain("win:");
    expect(yaml).toContain("nsis");
    expect(yaml).toContain("portable");

    // Linux: AppImage + deb, x64
    expect(yaml).toContain("linux:");
    expect(yaml).toContain("AppImage");
    expect(yaml).toContain("deb");
  });

  it("configures EPUB and PDF file associations and protocol schemes", async () => {
    const yaml = await fs.readFile(configPath, "utf8");

    expect(yaml).toContain("fileAssociations:");
    expect(yaml).toContain("ext: epub");
    expect(yaml).toContain("ext: pdf");

    expect(yaml).toContain("protocols:");
    expect(yaml).toContain("reflowpress");
  });

  it("follows deterministic artifact naming convention", async () => {
    const yaml = await fs.readFile(configPath, "utf8");

    expect(yaml).toContain("${productName}-Setup-${version}.${ext}");
    expect(yaml).toContain("${productName}-${version}-portable.${ext}");
    expect(yaml).toContain("${productName}-${version}-linux-${arch}.${ext}");
  });

  it("never lets electron-builder publish implicitly from packaging scripts", async () => {
    // Without --publish never, electron-builder on CI tries to look up a
    // GitHub draft release and fails when GH_TOKEN is absent. Releases are
    // published by the release workflow instead.
    const pkg = JSON.parse(
      await fs.readFile(path.resolve(__dirname, "../../package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    for (const name of ["package", "package:win", "package:linux"]) {
      expect(pkg.scripts[name]).toContain("--publish never");
    }
  });

  it("configures hardened Electron runtime fuses", async () => {
    const yaml = await fs.readFile(configPath, "utf8");

    expect(yaml).toContain("electronFuses:");
    expect(yaml).toContain("runAsNode: false");
    expect(yaml).toContain("enableCookieEncryption: true");
    expect(yaml).toContain("onlyLoadAppFromAsar: true");
    expect(yaml).toContain("grantFileProtocolExtraPrivileges: false");
    expect(yaml).toContain("enableNodeOptionsEnvironmentVariable: false");
    expect(yaml).toContain("enableNodeCliInspectArguments: false");
  });
});
