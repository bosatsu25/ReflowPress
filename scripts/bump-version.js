#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const targetVersion = process.argv[2];
if (!targetVersion || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(targetVersion)) {
  console.error(
    "Usage: node scripts/bump-version.js <new-version> (e.g. 1.0.0)",
  );
  process.exit(1);
}

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

// 1. Update packages/core/src/version.ts
const versionTsPath = path.join(ROOT_DIR, "packages/core/src/version.ts");
const versionTsContent = `/**
 * Canonical single source of truth for the ReflowPress release version.
 */
export const REFLOWPRESS_VERSION = "${targetVersion}";
`;
fs.writeFileSync(versionTsPath, versionTsContent, "utf-8");
console.log(
  `Updated ${path.relative(ROOT_DIR, versionTsPath)} -> ${targetVersion}`,
);

// 2. Update all package.json files
const packagePaths = getPackagePaths();
for (const p of packagePaths) {
  const raw = fs.readFileSync(p, "utf-8");
  const pkg = JSON.parse(raw);
  pkg.version = targetVersion;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  console.log(`Updated ${path.relative(ROOT_DIR, p)} -> ${targetVersion}`);
}

console.log(`\nSuccessfully bumped all version sources to "${targetVersion}".`);
