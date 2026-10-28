#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function computeFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest("hex");
}

export function generateChecksums(
  targetDir = path.join(rootDir, "release-artifacts"),
) {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }

  const entries = fs.readdirSync(targetDir);
  const eligibleFiles = entries
    .filter((file) => {
      const fullPath = path.join(targetDir, file);
      if (!fs.statSync(fullPath).isFile()) return false;
      if (file === "SHA256SUMS.txt") return false;
      if (file.endsWith(".blockmap")) return false;
      if (file.endsWith(".yml") || file.endsWith(".yaml")) return false;
      return true;
    })
    .sort();

  if (eligibleFiles.length === 0) {
    return { count: 0, checksums: [], outputPath: null };
  }

  const lines = [];
  const results = [];

  for (const file of eligibleFiles) {
    const fullPath = path.join(targetDir, file);
    const hash = computeFileSha256(fullPath);
    lines.push(`${hash}  ${file}`);
    results.push({ file, hash });
  }

  const checksumContent = lines.join("\n") + "\n";
  const outputPath = path.join(targetDir, "SHA256SUMS.txt");
  fs.writeFileSync(outputPath, checksumContent, "utf-8");

  return {
    count: results.length,
    checksums: results,
    outputPath,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  try {
    const res = generateChecksums();
    if (res.count === 0) {
      console.log("No eligible release files found for checksum generation.");
    } else {
      console.log(
        `✓ Generated ${res.outputPath} with ${res.count} file checksums:`,
      );
      for (const entry of res.checksums) {
        console.log(`  ${entry.hash.slice(0, 16)}...  ${entry.file}`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("✗ Failed to generate checksums:", err.message);
    process.exit(1);
  }
}
