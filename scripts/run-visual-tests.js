#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isLinux = process.platform === "linux";
const hasDisplay = Boolean(process.env.DISPLAY);

let command;
let commandArgs;

if (isLinux && !hasDisplay) {
  command = "xvfb-run";
  commandArgs = [
    "-a",
    "pnpm",
    "exec",
    "playwright",
    "test",
    "tests/e2e/visual-regression.spec.ts",
    ...args,
  ];
} else {
  command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  commandArgs = [
    "exec",
    "playwright",
    "test",
    "tests/e2e/visual-regression.spec.ts",
    ...args,
  ];
}

console.log(
  `[Visual Test Runner] Executing: ${command} ${commandArgs.join(" ")}`,
);
const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("[Visual Test Runner] Execution error:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
