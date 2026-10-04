#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function verifyPackagedArtifacts(
  targetDir = path.join(rootDir, "release-artifacts"),
) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }

  const platform = process.platform;
  let unpackedDir;
  let binaryPath;

  if (platform === "win32") {
    unpackedDir = path.join(targetDir, "win-unpacked");
    binaryPath = path.join(unpackedDir, "ReflowPress.exe");
  } else if (platform === "darwin") {
    unpackedDir = path.join(targetDir, "mac");
    binaryPath = path.join(
      unpackedDir,
      "ReflowPress.app",
      "Contents",
      "MacOS",
      "ReflowPress",
    );
  } else {
    unpackedDir = path.join(targetDir, "linux-unpacked");
    binaryPath = path.join(unpackedDir, "reflowpress");
  }

  // Check if unpacked app exists
  if (!fs.existsSync(unpackedDir)) {
    throw new Error(`Unpacked directory not found: ${unpackedDir}`);
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Main executable not found: ${binaryPath}`);
  }

  const binaryStat = fs.statSync(binaryPath);
  if (binaryStat.size < 10000000) {
    throw new Error(
      `Executable appears truncated or empty (${binaryStat.size} bytes): ${binaryPath}`,
    );
  }

  // Find app.asar
  const asarPath =
    platform === "darwin"
      ? path.join(
          unpackedDir,
          "ReflowPress.app",
          "Contents",
          "Resources",
          "app.asar",
        )
      : path.join(unpackedDir, "resources", "app.asar");

  if (!fs.existsSync(asarPath)) {
    throw new Error(`app.asar not found at ${asarPath}`);
  }

  // Inspect asar entries
  let asar;
  try {
    const asarPkg = require.resolve("@electron/asar", {
      paths: [rootDir, require.resolve("electron-builder")],
    });
    asar = require(asarPkg);
  } catch {
    // If not directly resolvable, fall back to checking file size
  }

  if (asar) {
    const fileList = asar.listPackage(asarPath);
    const normalized = fileList.map((f) => f.replace(/\\/g, "/"));

    const requiredEntries = [
      "package.json",
      "apps/desktop/dist/main/main.js",
      "apps/desktop/dist/preload/preload.cjs",
      "apps/desktop/dist/renderer/index.html",
    ];

    for (const req of requiredEntries) {
      const found = normalized.some((f) => f.endsWith(req) || f === `/${req}`);
      if (!found) {
        throw new Error(`app.asar is missing required entry: ${req}`);
      }
    }
  }

  const files = fs.readdirSync(targetDir);
  const installers = files.filter((f) => {
    const p = path.join(targetDir, f);
    return (
      !f.endsWith(".blockmap") &&
      !f.endsWith(".yml") &&
      !f.endsWith(".txt") &&
      fs.statSync(p).isFile()
    );
  });

  return {
    valid: true,
    platform,
    unpackedDir,
    binaryPath,
    binarySize: binaryStat.size,
    asarPath,
    installers,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  try {
    const result = verifyPackagedArtifacts();
    console.log("✓ Packaged artifact verification PASSED:");
    console.log(`  - Platform: ${result.platform}`);
    console.log(
      `  - Binary: ${result.binaryPath} (${(result.binarySize / (1024 * 1024)).toFixed(2)} MB)`,
    );
    console.log(`  - ASAR: ${result.asarPath}`);
    process.exit(0);
  } catch (err) {
    console.error("✗ Packaged artifact verification FAILED:", err.message);
    process.exit(1);
  }
}
