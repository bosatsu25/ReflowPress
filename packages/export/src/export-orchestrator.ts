import { promises as fs } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { loadEpub, EpubLoadingError } from "@reflowpress/epub";
import type { NormalizedPublication } from "@reflowpress/core";
import { generateDeterministicFilename } from "./filename.js";
import { exportToHtml } from "./html-exporter.js";
import { exportToMarkdown } from "./markdown-exporter.js";
import { exportToPdf } from "./pdf-exporter.js";
import {
  executeTransactionalWrite,
  executeTransactionalDirectoryWrite,
} from "./transaction.js";
import {
  ExportError,
  type ExportOptions,
  type ExportResult,
} from "./models.js";

/**
 * Validates input publication file and loads NormalizedPublication.
 */
async function loadPublication(
  sourcePath: string,
): Promise<NormalizedPublication> {
  const resolvedPath = path.resolve(sourcePath);

  // Check file exists
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new ExportError(
        "UNSUPPORTED_INPUT",
        `Input path '${sourcePath}' is not a regular file.`,
      );
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError(
      "INPUT_NOT_FOUND",
      `Input publication file not found at '${sourcePath}'`,
      { cause: error },
    );
  }

  // Validate extension (.epub)
  if (!resolvedPath.toLowerCase().endsWith(".epub")) {
    throw new ExportError(
      "UNSUPPORTED_INPUT",
      `ReflowPress Export Workbench currently only supports .epub files, received: '${sourcePath}'`,
    );
  }

  // Load publication
  let publication: NormalizedPublication;
  try {
    publication = await loadEpub(resolvedPath);
  } catch (error) {
    if (
      error instanceof EpubLoadingError &&
      error.code === "DRM_PROTECTED_PUBLICATION"
    ) {
      throw new ExportError(
        "DRM_PROTECTED_PUBLICATION",
        `Cannot export DRM-protected publication '${sourcePath}'. ReflowPress requires unencrypted content.`,
        { cause: error },
      );
    }
    throw new ExportError(
      "INVALID_EPUB",
      `Failed to load EPUB publication from '${sourcePath}': ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return publication;
}

/**
 * Exports an EPUB publication into specified format(s) (PDF, standalone HTML, and/or Markdown).
 */
export async function exportPublication(
  sourcePath: string,
  options: ExportOptions,
): Promise<readonly ExportResult[]> {
  const resolvedSourcePath = path.resolve(sourcePath);
  const publication = await loadPublication(resolvedSourcePath);

  const targetFormats: readonly ("pdf" | "html" | "markdown")[] =
    options.format === "all" ? ["pdf", "html", "markdown"] : [options.format];

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.dirname(resolvedSourcePath);

  await fs.mkdir(outputDir, { recursive: true });

  // Fix run timestamp across all formats in this publication export run
  const clockTime = (options.clock ?? (() => new Date()))();
  const runClock = () => clockTime;

  const results: ExportResult[] = [];

  for (const fmt of targetFormats) {
    const startTime = performance.now();

    const filenameResolution = await generateDeterministicFilename({
      sourcePath: resolvedSourcePath,
      format: fmt,
      overwrite: options.overwrite,
      clock: runClock,
      isCollision: async (candidate) => {
        try {
          await fs.stat(path.join(outputDir, candidate));
          return true;
        } catch {
          return false;
        }
      },
    });

    const targetFilePath = path.join(outputDir, filenameResolution.filename);

    if (fmt === "pdf") {
      const pdfExport = await exportToPdf(publication, options);
      const writeResult = await executeTransactionalWrite(
        targetFilePath,
        async (stagingPath) => {
          await fs.writeFile(stagingPath, Buffer.from(pdfExport.bytes));
        },
      );

      results.push({
        inputPath: resolvedSourcePath,
        format: "pdf",
        outputPath: writeResult.targetPath,
        byteSize: writeResult.byteSize,
        durationMs: Math.round(performance.now() - startTime),
        warnings: pdfExport.warnings,
      });
    } else if (fmt === "html") {
      const htmlExport = await exportToHtml(publication, options);
      const writeResult = await executeTransactionalWrite(
        targetFilePath,
        async (stagingPath) => {
          await fs.writeFile(stagingPath, htmlExport.html, "utf-8");
        },
      );

      results.push({
        inputPath: resolvedSourcePath,
        format: "html",
        outputPath: writeResult.targetPath,
        byteSize: writeResult.byteSize,
        durationMs: Math.round(performance.now() - startTime),
        warnings: htmlExport.warnings,
      });
    } else if (fmt === "markdown") {
      const baseStem = path.basename(targetFilePath, ".md");
      const assetDirName = `${baseStem}_assets`;
      const targetAssetDirPath = path.join(outputDir, assetDirName);

      const mdExport = exportToMarkdown(publication, {
        assetDirectoryName: assetDirName,
      });

      const writeResult = await executeTransactionalWrite(
        targetFilePath,
        async (stagingPath) => {
          await fs.writeFile(stagingPath, mdExport.markdown, "utf-8");
        },
      );

      let assetDirectoryPath: string | undefined;
      if (mdExport.assets.size > 0) {
        await executeTransactionalDirectoryWrite(
          targetAssetDirPath,
          async (stagingDir) => {
            for (const [filename, bytes] of mdExport.assets.entries()) {
              const assetFilePath = path.join(stagingDir, filename);
              await fs.mkdir(path.dirname(assetFilePath), { recursive: true });
              await fs.writeFile(assetFilePath, Buffer.from(bytes));
            }
          },
        );
        assetDirectoryPath = targetAssetDirPath;
      }

      results.push({
        inputPath: resolvedSourcePath,
        format: "markdown",
        outputPath: writeResult.targetPath,
        assetDirectoryPath,
        byteSize: writeResult.byteSize,
        durationMs: Math.round(performance.now() - startTime),
        warnings: mdExport.warnings,
      });
    }
  }

  return results;
}
