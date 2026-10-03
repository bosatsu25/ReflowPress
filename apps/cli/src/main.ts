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
import {
  inspectEpubHealth,
  inspectPdfHealth,
  evaluateQualityGate,
  type QualityProfile,
  type HealthReport,
} from "@reflowpress/quality";
import { planRepairs, executeRepair } from "@reflowpress/repair";

export const CLI_VERSION = "0.1.0";

export const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL_FAILURE: 1,
  FATAL_ERROR: 2,
} as const;

export interface CliOptions {
  readonly format?: ExportFormat | undefined;
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

export interface CliIo {
  stdout?: ((msg: string) => void) | undefined;
  stderr?: ((msg: string) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export function printHelp(): void {
  const helpText = `
ReflowPress Export Workbench CLI v${CLI_VERSION}

Usage:
  reflowpress [command] [options] <files or directories...>

Commands:
  export                      Export EPUB publications to PDF, HTML, or Markdown (default)
  inspect                     Inspect publication health (EPUB or PDF)
  validate                    Validate PDF outputs against Quality Gate profiles
  repair                      Plan or execute safe repairs on EPUB publications (dry-run by default)

Export Options:
  -f, --format <format>       Output format: pdf | html | markdown | all (default: pdf)
  -o, --output-dir <path>     Target output directory (default: adjacent to input)
  -s, --page-size <size>      PDF page size: A4 | A5 | B5 | Letter (default: A4)
  -m, --margin <margin>       PDF page margin (e.g., "20mm", "1in", "15mm")
  -w, --writing-mode <mode>   Writing mode: auto | horizontal-tb | vertical-rl (default: auto)
  -j, --jobs <n>              Concurrency level for batch exports (default: 4)
      --overwrite             Overwrite existing output files instead of appending -001
  -r, --recursive             Recursively find all .epub files in input directories

Inspect & Validation Options:
      --profile <profile>     PDF validation profile: baseline | reader-export (default: baseline)

Repair Options:
      --apply                 Execute safe repair and write repaired archive (default: preview only)
      --rule <id>             Filter repair actions to specific diagnostic rule ID
      --provenance            Write .provenance.json sidecar metadata

Global Options:
      --json                  Print structured JSON report to stdout
  -q, --quiet                 Suppress progress messages (errors still print to stderr)
  -v, --version               Show CLI version
  -h, --help                  Show this help message

Examples:
  reflowpress export book.epub --format pdf
  reflowpress inspect book.epub
  reflowpress validate exported.pdf --profile reader-export
  reflowpress repair book.epub
  reflowpress repair book.epub --apply --output-dir ./repaired
`;
  console.log(helpText.trim());
}

async function findFiles(
  targets: readonly string[],
  recursive: boolean,
  extensions: readonly string[],
): Promise<string[]> {
  const matchedPaths: string[] = [];

  for (const target of targets) {
    const resolved = path.resolve(target);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch {
      matchedPaths.push(resolved);
      continue;
    }

    if (stat.isFile()) {
      matchedPaths.push(resolved);
    } else if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved, {
        withFileTypes: true,
        recursive,
      });
      for (const entry of entries) {
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (extensions.some((ext) => lower.endsWith(ext))) {
            const parent =
              (entry as { parentPath?: string }).parentPath ?? resolved;
            matchedPaths.push(path.join(parent, entry.name));
          }
        }
      }
    }
  }

  return [...new Set(matchedPaths)].sort();
}

/**
 * Runs the ReflowPress command-line interface.
 * Returns the process exit code (0, 1, or 2).
 */
export async function runCli(
  args: readonly string[],
  io: CliIo = {},
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
        profile: { type: "string", default: "baseline" },
        apply: { type: "boolean", default: false },
        rule: { type: "string" },
        provenance: { type: "boolean", default: false },
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

  const command = ["export", "inspect", "validate", "repair"].includes(
    positionals[0] ?? "",
  )
    ? positionals[0]!
    : "export";

  const rawInputs = ["export", "inspect", "validate", "repair"].includes(
    positionals[0] ?? "",
  )
    ? positionals.slice(1)
    : positionals;

  if (rawInputs.length === 0) {
    logErr("Error: No input files or directories specified.");
    logErr("Run 'reflowpress --help' for usage instructions.");
    return EXIT_CODES.FATAL_ERROR;
  }

  const isQuiet = Boolean(values.quiet);
  const isJson = Boolean(values.json);
  const isRecursive = Boolean(values.recursive);

  // Dispatch to subcommand
  if (command === "inspect") {
    return runInspect(rawInputs, { isJson, isQuiet, isRecursive }, log, logErr);
  }

  if (command === "validate") {
    const profile = (
      values.profile === "reader-export" ? "reader-export" : "baseline"
    ) as QualityProfile;
    return runValidate(
      rawInputs,
      { profile, isJson, isQuiet, isRecursive },
      log,
      logErr,
    );
  }

  if (command === "repair") {
    return runRepair(
      rawInputs,
      {
        apply: Boolean(values.apply),
        ruleId: values.rule,
        outputDir: values["output-dir"],
        provenance: Boolean(values.provenance),
        isJson,
        isQuiet,
        isRecursive,
      },
      log,
      logErr,
    );
  }

  // Default: export
  return runExport(
    rawInputs,
    values,
    { isJson, isQuiet, isRecursive, signal: io.signal },
    log,
    logErr,
  );
}

async function runInspect(
  inputs: readonly string[],
  options: { isJson: boolean; isQuiet: boolean; isRecursive: boolean },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".epub", ".pdf"]);
  if (files.length === 0) {
    logErr(
      `Error: No .epub or .pdf files found matching inputs: ${inputs.join(", ")}`,
    );
    return EXIT_CODES.FATAL_ERROR;
  }

  const reports: HealthReport[] = [];
  let hasFatalOrError = false;
  let hasWarning = false;

  for (const file of files) {
    let report: HealthReport;
    if (file.toLowerCase().endsWith(".pdf")) {
      try {
        const bytes = await fs.readFile(file);
        report = inspectPdfHealth(bytes, file);
      } catch (err) {
        logErr(
          `Failed to read PDF '${file}': ${err instanceof Error ? err.message : String(err)}`,
        );
        hasFatalOrError = true;
        continue;
      }
    } else {
      report = await inspectEpubHealth(file);
    }

    reports.push(report);
    if (report.summary.fatalCount > 0 || report.summary.errorCount > 0) {
      hasFatalOrError = true;
    }
    if (report.summary.warningCount > 0) {
      hasWarning = true;
    }
  }

  if (options.isJson) {
    log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else if (!options.isQuiet) {
    for (const report of reports) {
      log(
        `\n=== Publication Health Report: ${path.basename(report.publicationPath)} ===`,
      );
      log(
        `Type: ${report.publicationType.toUpperCase()} | Duration: ${report.durationMs}ms`,
      );
      log(
        `Findings: ${report.summary.totalFindings} (Fatal: ${report.summary.fatalCount}, Error: ${report.summary.errorCount}, Warning: ${report.summary.warningCount}, Info: ${report.summary.infoCount})`,
      );
      log(
        `Repairable: ${report.summary.safeRepairableCount} safe-auto, ${report.summary.reviewRequiredCount} review-required, ${report.summary.manualCount} manual`,
      );

      if (report.findings.length > 0) {
        log("\nDiagnostics:");
        for (const f of report.findings) {
          const loc = f.location?.path
            ? ` [${f.location.path}${f.location.line ? `:${f.location.line}` : ""}]`
            : "";
          log(
            `  [${f.severity.toUpperCase()}] ${f.ruleId}${loc}: ${f.message}`,
          );
        }
      } else {
        log("\n✓ No quality issues found. Publication is healthy.");
      }
    }
  }

  if (hasFatalOrError) return EXIT_CODES.FATAL_ERROR;
  if (hasWarning) return EXIT_CODES.PARTIAL_FAILURE;
  return EXIT_CODES.SUCCESS;
}

async function runValidate(
  inputs: readonly string[],
  options: {
    profile: QualityProfile;
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".pdf"]);
  if (files.length === 0) {
    logErr(`Error: No .pdf files found matching inputs: ${inputs.join(", ")}`);
    return EXIT_CODES.FATAL_ERROR;
  }

  const results = [];
  let allPassed = true;

  for (const file of files) {
    try {
      const bytes = await fs.readFile(file);
      const report = inspectPdfHealth(bytes, file);
      const gateResult = evaluateQualityGate(report, options.profile);
      results.push(gateResult);
      if (!gateResult.passed) {
        allPassed = false;
      }
    } catch (err) {
      logErr(
        `Failed to read PDF '${file}': ${err instanceof Error ? err.message : String(err)}`,
      );
      allPassed = false;
    }
  }

  if (options.isJson) {
    log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else if (!options.isQuiet) {
    for (const res of results) {
      const statusStr = res.passed ? "PASS" : "FAIL";
      log(
        `[${statusStr}] ${path.basename(res.report.publicationPath)} (profile: ${res.profile})`,
      );
      if (!res.passed) {
        for (const v of res.violations) {
          log(`  - [${v.severity.toUpperCase()}] ${v.ruleId}: ${v.message}`);
        }
      }
    }
  }

  return allPassed ? EXIT_CODES.SUCCESS : EXIT_CODES.FATAL_ERROR;
}

async function runRepair(
  inputs: readonly string[],
  options: {
    apply: boolean;
    ruleId?: string | undefined;
    outputDir?: string | undefined;
    provenance: boolean;
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
  const files = await findFiles(inputs, options.isRecursive, [".epub"]);
  if (files.length === 0) {
    logErr(`Error: No .epub files found matching inputs: ${inputs.join(", ")}`);
    return EXIT_CODES.FATAL_ERROR;
  }

  const results = [];
  let hasFailure = false;

  for (const file of files) {
    const report = await inspectEpubHealth(file);
    const { plan, preview } = planRepairs(report, {
      specificRuleIds: options.ruleId ? [options.ruleId] : undefined,
    });

    if (!options.apply) {
      // Dry-run preview
      results.push({ publication: file, plan, preview, mode: "dry-run" });
      if (!options.isJson && !options.isQuiet) {
        log(`\n=== Repair Preview (Dry Run): ${path.basename(file)} ===`);
        log(
          `Planned actions: ${plan.actions.length} (${plan.safeActionCount} safe-auto)`,
        );
        if (plan.actions.length === 0) {
          log("No repairable issues detected.");
        } else {
          for (const action of plan.actions) {
            log(
              `  - [${action.risk.toUpperCase()}] ${action.title} (${action.targetFile})`,
            );
          }
          log(
            "\nRun with '--apply' to execute these repairs non-destructively.",
          );
        }
      }
    } else {
      // Execute repair
      if (plan.actions.length === 0) {
        results.push({
          publication: file,
          success: true,
          message: "No repairs needed",
        });
        if (!options.isQuiet && !options.isJson) {
          log(`\n${path.basename(file)}: No repairable issues found.`);
        }
        continue;
      }

      const repairResult = await executeRepair(file, plan, {
        outputDir: options.outputDir
          ? path.resolve(options.outputDir)
          : undefined,
        writeProvenance: options.provenance,
      });

      results.push(repairResult);
      if (!repairResult.success) {
        hasFailure = true;
        if (!options.isQuiet && !options.isJson) {
          logErr(
            `\nRepair failed for ${path.basename(file)}: ${repairResult.error}`,
          );
        }
      } else if (!options.isQuiet && !options.isJson) {
        log(`\n✓ Repaired publication created: ${repairResult.outputPath}`);
        log(
          `  Applied ${repairResult.actionsApplied.length} action(s). Verified clean with 0 regressions.`,
        );
      }
    }
  }

  if (options.isJson) {
    log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }

  return hasFailure ? EXIT_CODES.FATAL_ERROR : EXIT_CODES.SUCCESS;
}

interface ExportCliValues {
  readonly format?: string | undefined;
  readonly "page-size"?: string | undefined;
  readonly "writing-mode"?: string | undefined;
  readonly "output-dir"?: string | undefined;
  readonly margin?: string | undefined;
  readonly jobs?: string | undefined;
  readonly overwrite?: boolean | undefined;
}

async function runExport(
  rawInputs: readonly string[],
  values: ExportCliValues,
  options: {
    isJson: boolean;
    isQuiet: boolean;
    isRecursive: boolean;
    signal?: AbortSignal | undefined;
  },
  log: (m: string) => void,
  logErr: (m: string) => void,
): Promise<number> {
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

  const epubFiles = await findFiles(rawInputs, options.isRecursive, [".epub"]);
  if (epubFiles.length === 0) {
    logErr(
      `Error: No .epub files found matching input targets: ${rawInputs.join(", ")}`,
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

  if (
    epubFiles.length === 1 &&
    rawInputs.length === 1 &&
    !options.isRecursive
  ) {
    const singleFile = epubFiles[0]!;
    if (!options.isQuiet && !options.isJson) {
      log(
        `Exporting publication: ${path.basename(singleFile)} [format: ${format}]...`,
      );
    }

    try {
      const results = await exportPublication(singleFile, exportOpts);
      if (options.isJson) {
        log(
          JSON.stringify(
            { success: true, count: results.length, results },
            null,
            2,
          ),
        );
      } else if (!options.isQuiet) {
        for (const res of results) {
          log(
            `Exported [${res.format.toUpperCase()}]: ${res.outputPath} (${(res.byteSize / 1024).toFixed(1)} KB) in ${res.durationMs}ms`,
          );
        }
      }
      return EXIT_CODES.SUCCESS;
    } catch (error) {
      if (options.isJson) {
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

  if (!options.isQuiet && !options.isJson) {
    log(
      `Starting batch export of ${epubFiles.length} publication(s) [format: ${format}]...`,
    );
  }

  const report: BatchExportReport = await exportBatch(epubFiles, {
    ...exportOpts,
    jobs,
    signal: options.signal,
    onProgress: (done, total, file) => {
      if (!options.isQuiet && !options.isJson) {
        log(`[${done}/${total}] Processed ${path.basename(file)}`);
      }
    },
  });

  if (options.isJson) {
    log(JSON.stringify(report, null, 2));
  } else if (!options.isQuiet) {
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

  if (report.failedFiles === 0) return EXIT_CODES.SUCCESS;
  if (report.successfulFiles > 0) return EXIT_CODES.PARTIAL_FAILURE;
  return EXIT_CODES.FATAL_ERROR;
}
