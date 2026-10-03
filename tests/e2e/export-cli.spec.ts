import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CLI_PATH = path.resolve(REPO_ROOT, "apps/cli/dist/cli.js");
const FIXTURES_DIR = path.resolve(REPO_ROOT, "tests/fixtures");
const E2E_OUTPUT_DIR = path.resolve(REPO_ROOT, "scratch/e2e-cli-output");

function runCliProcess(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test.describe("Headless Export CLI E2E", () => {
  const sampleEpub = path.join(FIXTURES_DIR, "sample.epub");
  const japaneseEpub = path.join(FIXTURES_DIR, "sample-japanese.epub");

  test.beforeEach(async () => {
    await fs.mkdir(E2E_OUTPUT_DIR, { recursive: true });
  });

  test.afterEach(async () => {
    await fs
      .rm(E2E_OUTPUT_DIR, { recursive: true, force: true })
      .catch(() => {});
  });

  test("CLI prints help message and exits with 0", async () => {
    const { code, stdout } = await runCliProcess(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("ReflowPress Export Workbench CLI");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--page-size");
    expect(stdout).toContain("--writing-mode");
  });

  test("CLI exports Japanese publication to PDF, HTML, and Markdown simultaneously", async () => {
    const { code, stdout } = await runCliProcess([
      "export",
      japaneseEpub,
      "--format",
      "all",
      "--output-dir",
      E2E_OUTPUT_DIR,
      "--writing-mode",
      "vertical-rl",
      "--page-size",
      "A4",
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain("Exported [PDF]");
    expect(stdout).toContain("Exported [HTML]");
    expect(stdout).toContain("Exported [MARKDOWN]");

    const files = await fs.readdir(E2E_OUTPUT_DIR);
    const pdfFile = files.find((f) => f.endsWith(".pdf"));
    const htmlFile = files.find((f) => f.endsWith(".html"));
    const mdFile = files.find((f) => f.endsWith(".md"));

    expect(pdfFile).toBeDefined();
    expect(htmlFile).toBeDefined();
    expect(mdFile).toBeDefined();

    // Verify PDF header
    const pdfBuffer = await fs.readFile(path.join(E2E_OUTPUT_DIR, pdfFile!));
    expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    // Verify HTML content
    const htmlContent = await fs.readFile(
      path.join(E2E_OUTPUT_DIR, htmlFile!),
      "utf-8",
    );
    expect(htmlContent).toContain("<!DOCTYPE html>");
    expect(htmlContent).toContain("ReflowPress 日本語組版サンプル");
    expect(htmlContent).toContain("writing-mode: vertical-rl");
    expect(htmlContent).not.toContain("<script>");

    // Verify Markdown content
    const mdContent = await fs.readFile(
      path.join(E2E_OUTPUT_DIR, mdFile!),
      "utf-8",
    );
    expect(mdContent).toContain("---");
    expect(mdContent).toContain('title: "ReflowPress 日本語組版サンプル"');
    expect(mdContent).toContain("吾輩（わがはい）は猫である。");
    expect(mdContent).toContain("<math");
  });

  test("CLI handles output collisions deterministically", async () => {
    // Run 1
    const run1 = await runCliProcess([
      "export",
      sampleEpub,
      "--format",
      "html",
      "--output-dir",
      E2E_OUTPUT_DIR,
    ]);
    expect(run1.code).toBe(0);

    // Run 2 (overwrite: false)
    const run2 = await runCliProcess([
      "export",
      sampleEpub,
      "--format",
      "html",
      "--output-dir",
      E2E_OUTPUT_DIR,
    ]);
    expect(run2.code).toBe(0);

    const files = await fs.readdir(E2E_OUTPUT_DIR);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.every((f) => f.endsWith(".html"))).toBe(true);
  });

  test("CLI performs batch export and emits structured JSON report", async () => {
    const { code, stdout } = await runCliProcess([
      "export",
      sampleEpub,
      japaneseEpub,
      "--format",
      "html",
      "--output-dir",
      E2E_OUTPUT_DIR,
      "--jobs",
      "2",
      "--json",
    ]);

    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.totalFiles).toBe(2);
    expect(report.successfulFiles).toBe(2);
    expect(report.failedFiles).toBe(0);
    expect(report.totalOutputs).toBe(2);
  });

  test("CLI reports error code 2 when target input file is not found", async () => {
    const { code, stderr } = await runCliProcess([
      "export",
      path.join(FIXTURES_DIR, "non-existent-book.epub"),
      "--format",
      "html",
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain("INPUT_NOT_FOUND");
  });
});
