#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function getPackagePaths() {
  const paths = [path.join(ROOT_DIR, "package.json")];

  const packagesDir = path.join(ROOT_DIR, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const dir of fs.readdirSync(packagesDir)) {
      const p = path.join(packagesDir, dir, "package.json");
      if (fs.existsSync(p)) paths.push(p);
    }
  }

  const appsDir = path.join(ROOT_DIR, "apps");
  if (fs.existsSync(appsDir)) {
    for (const dir of fs.readdirSync(appsDir)) {
      const p = path.join(appsDir, dir, "package.json");
      if (fs.existsSync(p)) paths.push(p);
    }
  }

  return paths;
}

export function checkVersionConsistency() {
  const versionTsPath = path.join(ROOT_DIR, "packages/core/src/version.ts");
  if (!fs.existsSync(versionTsPath)) {
    throw new Error(`Missing canonical version file: ${versionTsPath}`);
  }

  const versionTsContent = fs.readFileSync(versionTsPath, "utf-8");
  const match = versionTsContent.match(
    /REFLOWPRESS_VERSION\s*=\s*["']([^"']+)["']/,
  );
  if (!match || !match[1]) {
    throw new Error(
      `Failed to extract REFLOWPRESS_VERSION from ${versionTsPath}`,
    );
  }
  const canonicalVersion = match[1];

  const packagePaths = getPackagePaths();
  const mismatches = [];

  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const relPath = path.relative(ROOT_DIR, pkgPath).replace(/\\/g, "/");
    if (pkg.version !== canonicalVersion) {
      mismatches.push({
        file: relPath,
        name: pkg.name ?? "unnamed",
        found: pkg.version,
        expected: canonicalVersion,
      });
    }
  }

  return {
    canonicalVersion,
    checkedCount: packagePaths.length + 1,
    mismatches,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const res = checkVersionConsistency();
    if (res.mismatches.length > 0) {
      console.error(
        `Version inconsistency detected! Canonical version is "${res.canonicalVersion}".\n`,
      );
      for (const m of res.mismatches) {
        console.error(
          `  - ${m.file} (${m.name}): found "${m.found}", expected "${m.expected}"`,
        );
      }
      process.exit(1);
    }
    console.log(
      `✓ All ${res.checkedCount} version sources strictly match canonical version "${res.canonicalVersion}".`,
    );
  } catch (err) {
    console.error(`Error checking version consistency:`, err);
    process.exit(1);
  }
}
