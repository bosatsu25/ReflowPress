#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rendererDistDir = path.resolve(
  __dirname,
  "../apps/desktop/dist/renderer/assets",
);

if (!fs.existsSync(rendererDistDir)) {
  console.error(
    `Error: Renderer assets directory not found at ${rendererDistDir}. Run 'pnpm build' first.`,
  );
  process.exit(1);
}

const files = fs.readdirSync(rendererDistDir);
const CHUNK_BUDGET_KB = 500;

console.log("==================================================");
console.log("ReflowPress Desktop Renderer Bundle Analysis");
console.log("==================================================\n");

let exceededBudget = false;

for (const file of files) {
  const filePath = path.join(rendererDistDir, file);
  const stat = fs.statSync(filePath);
  const rawBytes = stat.size;
  const rawKb = (rawBytes / 1024).toFixed(2);

  const fileContent = fs.readFileSync(filePath);
  const gzipBytes = zlib.gzipSync(fileContent).length;
  const gzipKb = (gzipBytes / 1024).toFixed(2);

  const isWorker = file.startsWith("pdf.worker.min");
  const isJs = file.endsWith(".js");

  let status = "OK";
  if (isJs && !isWorker && rawBytes > CHUNK_BUDGET_KB * 1024) {
    status = "EXCEEDED BUDGET";
    exceededBudget = true;
  }

  console.log(
    `- ${file.padEnd(45)} | Raw: ${rawKb.padStart(8)} kB | Gzip: ${gzipKb.padStart(7)} kB | [${status}]`,
  );
}

console.log("\n==================================================");
if (exceededBudget) {
  console.error(
    `FAILED: One or more application JavaScript chunks exceeded the ${CHUNK_BUDGET_KB} kB budget!`,
  );
  process.exit(1);
} else {
  console.log(
    `PASSED: All application JavaScript chunks within ${CHUNK_BUDGET_KB} kB budget.`,
  );
}
