import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  exportBatch,
  exportPublication,
  type ExportFormat,
  type ExportPageSize,
  type ExportWritingMode,
  type BatchExportReport,
} from "@reflowpress/export";

export const CLI_VERSION = "0.1.0";

export const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL_FAILURE: 1,
  FATAL_ERROR: 2,
} as const;

export interface CliOptions {
  readonly format: ExportFormat;
  readonly outputDir?: string | undefined;
  readonly pageSize?: ExportPageSize | undefined;
  readonly margin?: string | undefined;
  readonly writingMode?: ExportWritingMode | undefined;
  readonly jobs?: number | undefined;
  readonly overwrite?: boolean | undefined;
  readonly recursive?: boolean | undefined;
  readonly json?: boolean | undefined;
  readonly quiet?: boolean | undefined;
}

export function printHelp(): void {
  const helpText = `
ReflowPress Export Workbench CLI v${CLI_VERSION}

Usage:
  reflowpress export [options] <files or directories...>
  reflowpress [options] <files or directories...>

Commands:
  export                      Export EPUB publications to PDF, HTML, or Markdown (default)

Options:
  -f, --format <format>       Output format: pdf | html | markdown | all (default: pdf)
  -o, --output-dir <path>     Target output directory (default: adjacent to input)
  -s, --page-size <size>      PDF page size: A4 | A5 | B5 | Letter (default: A4)
  -m, --margin <margin>       PDF page margin (e.g., "20mm", "1in", "15mm")
  -w, --writing-mode <mode>   Writing mode: auto | horizontal-tb | vertical-rl (default: auto)
  -j, --jobs <n>              Concurrency level for batch exports (default: 4)
      --overwrite             Overwrite existing output files instead of appending -001
  -r, --recursive             Recursively find all .epub files in input directories
      --json                  Print structured JSON report to stdout
  -q, --quiet                 Suppress progress messages (errors still print to stderr)
  -v, --version               Show CLI version
  -h, --help                  Show this help message

Examples:
  reflowpress export book.epub --format pdf
  reflowpress export ./library --recursive --format all --output-dir ./dist
  reflowpress export novel.epub --format pdf --writing-mode vertical-rl --page-size B5
`;
  console.log(helpText.trim());
}

async function findEpubFiles(
  targets: readonly string[],
  recursive: boolean,
): Promise<string[]> {
  const epubPaths: string[] = [];

  for (const target of targets) {
    const resolved = path.resolve(target);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      // If an explicitly specified target does not exist, include it so the orchestrator
      // or batch runner can report the missing file error cleanly
      epubPaths.push(resolved);
      continue;
    }

    if (stat.isFile()) {
      epubPaths.push(resolved);
    } else if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved, {
        withFileTypes: true,
        recursive,
      });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".epub")) {
          const parent =
            (entry as { parentPath?: string }).parentPath ?? resolved;
          epubPaths.push(path.join(parent, entry.name));
        }
      }
    }
  }

  return [...new Set(epubPaths)].sort();
}

/**
 * Runs the ReflowPress command-line interface.
 * Returns the process exit code (0, 1, or 2).
 */
export async function runCli(
  args: readonly string[],
  io: {
    stdout?: (msg: string) => void;
    stderr?: (msg: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<number> {
  const log = io.stdout ?? ((m: string) => console.log(m));
  const logErr = io.stderr ?? ((m: string) => console.error(m));

  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        format: { type: "string", short: "f", default: "pdf" },
        "output-dir": { type: "string", short: "o" },
        "page-size": { type: "string", short: "s", default: "A4" },
        margin: { type: "string", short: "m" },
        "writing-mode": { type: "string", short: "w", default: "auto" },
        jobs: { type: "string", short: "j" },
        overwrite: { type: "boolean", default: false },
        recursive: { type: "boolean", short: "r", default: false },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        version: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    logErr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    logErr("Run 'reflowpress --help' for usage instructions.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    printHelp();
    return EXIT_CODES.SUCCESS;
  }

  if (values.version) {
    log(`ReflowPress CLI v${CLI_VERSION}`);
    return EXIT_CODES.SUCCESS;
  }

  // Strip sub-command "export" if provided as first positional argument
  const targetInputs =
    positionals[0] === "export" ? positionals.slice(1) : positionals;

  if (targetInputs.length === 0) {
    logErr("Error: No input files or directories specified.");
    logErr("Run 'reflowpress --help' for usage instructions.");
    return EXIT_CODES.FATAL_ERROR;
  }

  // Validate format
  const formatStr = values.format?.toLowerCase() || "pdf";
  if (!["pdf", "html", "markdown", "all"].includes(formatStr)) {
    logErr(
      `Error: Invalid format '${formatStr}'. Must be one of: pdf, html, markdown, all.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const format = formatStr as ExportFormat;

  // Validate page-size
  const pageSizeStr = values["page-size"] || "A4";
  if (!["A4", "A5", "B5", "Letter"].includes(pageSizeStr)) {
    logErr(
      `Error: Invalid page size '${pageSizeStr}'. Must be one of: A4, A5, B5, Letter.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const pageSize = pageSizeStr as ExportPageSize;

  // Validate writing-mode
  const writingModeStr = values["writing-mode"] || "auto";
  if (!["auto", "horizontal-tb", "vertical-rl"].includes(writingModeStr)) {
    logErr(
      `Error: Invalid writing mode '${writingModeStr}'. Must be one of: auto, horizontal-tb, vertical-rl.`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }
  const writingMode = writingModeStr as ExportWritingMode;

  const jobs = values.jobs ? parseInt(values.jobs, 10) : undefined;
  if (jobs !== undefined && (isNaN(jobs) || jobs < 1)) {
    logErr("Error: --jobs must be a positive integer.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const isQuiet = Boolean(values.quiet);
  const isJson = Boolean(values.json);
  const isRecursive = Boolean(values.recursive);

  // Discover EPUB files
  const epubFiles = await findEpubFiles(targetInputs, isRecursive);
  if (epubFiles.length === 0) {
    logErr(
      `Error: No .epub files found matching input targets: ${targetInputs.join(", ")}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }

  const exportOpts = {
    format,
    ...(values["output-dir"]
      ? { outputDir: path.resolve(values["output-dir"]) }
      : {}),
    pageSize,
    ...(values.margin ? { margin: values.margin } : {}),
    writingMode,
    overwrite: Boolean(values.overwrite),
  };

  // Single file vs Batch
  if (epubFiles.length === 1 && targetInputs.length === 1 && !isRecursive) {
    const singleFile = epubFiles[0]!;
    if (!isQuiet && !isJson) {
      log(
        `Exporting publication: ${path.basename(singleFile)} [format: ${format}]...`,
      );
    }

    try {
      const results = await exportPublication(singleFile, exportOpts);
      if (isJson) {
        log(
          JSON.stringify(
            { success: true, count: results.length, results },
            null,
            2,
          ),
        );
      } else if (!isQuiet) {
        for (const res of results) {
          log(
            `Exported [${res.format.toUpperCase()}]: ${res.outputPath} (${(res.byteSize / 1024).toFixed(1)} KB) in ${res.durationMs}ms`,
          );
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (error) {
      if (isJson) {
        log(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        );
      } else {
        logErr(
          `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return EXIT_CODES.FATAL_ERROR;
    }
  }

  // Batch export
  if (!isQuiet && !isJson) {
    log(
      `Starting batch export of ${epubFiles.length} publication(s) [format: ${format}]...`,
    );
  }

  const report: BatchExportReport = await exportBatch(epubFiles, {
    ...exportOpts,
    jobs,
    signal: io.signal,
    onProgress: (done, total, file) => {
      if (!isQuiet && !isJson) {
        log(`[${done}/${total}] Processed ${path.basename(file)}`);
      }
    },
  });

  if (isJson) {
    log(JSON.stringify(report, null, 2));
  } else if (!isQuiet) {
    log("\n--- Batch Export Summary ---");
    log(`Total files:      ${report.totalFiles}`);
    log(`Successful:       ${report.successfulFiles}`);
    log(`Failed:           ${report.failedFiles}`);
    log(`Outputs produced: ${report.totalOutputs}`);
    log(`Total size:       ${(report.totalByteSize / 1024).toFixed(1)} KB`);
    log(`Duration:         ${report.durationMs}ms`);
    if (report.failedFiles > 0) {
      log("\nFailed files:");
      for (const item of report.items) {
        if (!item.success) {
          log(
            `  - ${path.basename(item.inputPath)}: [${item.errorCode}] ${item.error}`,
          );
        }
      }
    }
  }

  if (report.failedFiles === 0) {
    return EXIT_CODES.SUCCESS;
  }
  if (report.successfulFiles > 0) {
    return EXIT_CODES.PARTIAL_FAILURE;
  }
  return EXIT_CODES.FATAL_ERROR;
}
