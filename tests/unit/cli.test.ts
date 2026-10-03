import * as path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli, EXIT_CODES } from "../../apps/cli/src/main.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TEMP_OUTPUT_DIR = path.resolve(
  __dirname,
  "../../scratch/cli-test-output",
);

describe("CLI (runCli)", () => {
  const sampleEpub = path.join(FIXTURES_DIR, "sample.epub");
  const japaneseEpub = path.join(FIXTURES_DIR, "sample-japanese.epub");

  beforeEach(async () => {
    await fs.mkdir(TEMP_OUTPUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs
      .rm(TEMP_OUTPUT_DIR, { recursive: true, force: true })
      .catch(() => {});
  });

  it("handles --help flag with exit code 0", async () => {
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(["--help"], {
      stdout: (msg) => stdoutLogs.push(msg),
    });

    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it("handles --version flag with exit code 0", async () => {
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(["--version"], {
      stdout: (msg) => stdoutLogs.push(msg),
    });

    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutLogs.join("\n")).toContain("ReflowPress CLI v0.1.0");
  });

  it("returns fatal error when no arguments or files are specified", async () => {
    const stderrLogs: string[] = [];
    const exitCode = await runCli([], {
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(exitCode).toBe(EXIT_CODES.FATAL_ERROR);
    expect(stderrLogs.some((l) => l.includes("No input files"))).toBe(true);
  });

  it("returns fatal error when invalid format is provided", async () => {
    const stderrLogs: string[] = [];
    const exitCode = await runCli(["export", sampleEpub, "--format", "docx"], {
      stderr: (msg) => stderrLogs.push(msg),
    });

    expect(exitCode).toBe(EXIT_CODES.FATAL_ERROR);
    expect(stderrLogs.some((l) => l.includes("Invalid format"))).toBe(true);
  });

  it("exports a single publication to HTML successfully", async () => {
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(
      [
        "export",
        sampleEpub,
        "--format",
        "html",
        "--output-dir",
        TEMP_OUTPUT_DIR,
      ],
      { stdout: (msg) => stdoutLogs.push(msg) },
    );

    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    const files = await fs.readdir(TEMP_OUTPUT_DIR);
    expect(
      files.some((f) => f.startsWith("sample_") && f.endsWith(".html")),
    ).toBe(true);
  });

  it("exports a single publication to Markdown with JSON output", async () => {
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(
      [
        "export",
        japaneseEpub,
        "--format",
        "markdown",
        "--output-dir",
        TEMP_OUTPUT_DIR,
        "--json",
      ],
      { stdout: (msg) => stdoutLogs.push(msg) },
    );

    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
    const parsed = JSON.parse(stdoutLogs.join(""));
    expect(parsed.success).toBe(true);
    expect(parsed.results[0].format).toBe("markdown");

    const files = await fs.readdir(TEMP_OUTPUT_DIR);
    expect(
      files.some((f) => f.startsWith("sample-japanese_") && f.endsWith(".md")),
    ).toBe(true);
  });

  it("exports a batch of publications with exit code 0 when all succeed", async () => {
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(
      [
        "export",
        sampleEpub,
        japaneseEpub,
        "--format",
        "html",
        "--output-dir",
        TEMP_OUTPUT_DIR,
        "--jobs",
        "2",
      ],
      { stdout: (msg) => stdoutLogs.push(msg) },
    );

    expect(exitCode).toBe(EXIT_CODES.SUCCESS);
  }, 20000);

  it("returns partial failure code (1) when some batch files fail", async () => {
    const nonExistent = path.join(FIXTURES_DIR, "missing.epub");
    const stdoutLogs: string[] = [];
    const exitCode = await runCli(
      [
        "export",
        sampleEpub,
        nonExistent,
        "--format",
        "html",
        "--output-dir",
        TEMP_OUTPUT_DIR,
      ],
      { stdout: (msg) => stdoutLogs.push(msg) },
    );

    expect(exitCode).toBe(EXIT_CODES.PARTIAL_FAILURE);
  }, 20000);
});
