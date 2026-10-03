import { createHash } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectEpubHealth } from "@reflowpress/quality";
import * as yauzl from "yauzl";
import type { RepairPlan, RepairProvenance, RepairResult } from "./models.js";
import { buildCanonicalEpubZip, type ZipOutputEntry } from "./rewriter.js";

export interface ExecuteRepairOptions {
  readonly outputDir?: string | undefined;
  readonly outputPath?: string | undefined;
  readonly writeProvenance?: boolean | undefined;
  readonly toolVersion?: string | undefined;
}

export async function executeRepair(
  sourcePath: string,
  plan: RepairPlan,
  options: ExecuteRepairOptions = {},
): Promise<RepairResult> {
  const preReport = await inspectEpubHealth(sourcePath, {
    toolVersion: options.toolVersion,
  });

  if (plan.actions.length === 0) {
    return {
      success: false,
      sourcePath,
      actionsApplied: [],
      preHealthReport: preReport,
      error: "No repair actions specified in repair plan.",
    };
  }

  // Determine final output path
  let finalOutputPath = options.outputPath;
  if (!finalOutputPath) {
    const parsed = path.parse(sourcePath);
    const timestamp = formatTimestamp(new Date());
    const newName = `${parsed.name}_repaired_${timestamp}${parsed.ext || ".epub"}`;
    finalOutputPath = options.outputDir
      ? path.join(options.outputDir, newName)
      : path.join(parsed.dir, newName);
  }

  const stagingPath = `${finalOutputPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // 1. Read existing entries from source ZIP
    const archive = await yauzl.openPromise(sourcePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: false,
      validateEntrySizes: false,
    });

    const entriesMap = new Map<string, Buffer>();
    let opfFilePath: string | undefined;

    try {
      for await (const entry of archive.eachEntry()) {
        const buf = await readZipEntry(archive, entry);
        entriesMap.set(entry.fileName, buf);
        if (entry.fileName.endsWith(".opf")) {
          opfFilePath = entry.fileName;
        }
      }
    } finally {
      archive.close();
    }

    const appliedActions: string[] = [];

    // 2. Apply repair actions
    for (const action of plan.actions) {
      if (action.type === "canonical-mimetype") {
        entriesMap.set(
          "mimetype",
          Buffer.from("application/epub+zip", "utf-8"),
        );
        appliedActions.push(action.id);
      } else if (action.type === "container-xml") {
        if (!opfFilePath) {
          // If no OPF file known, check keys
          for (const k of entriesMap.keys()) {
            if (k.endsWith(".opf")) {
              opfFilePath = k;
              break;
            }
          }
        }
        if (opfFilePath) {
          const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfFilePath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
          entriesMap.set(
            "META-INF/container.xml",
            Buffer.from(containerXml, "utf-8"),
          );
          appliedActions.push(action.id);
        }
      } else if (action.type === "manifest-mediatype") {
        const targetFile = action.targetFile || opfFilePath;
        if (targetFile && entriesMap.has(targetFile)) {
          let opfStr = entriesMap.get(targetFile)!.toString("utf-8");
          if (action.beforeSnippet && action.afterSnippet) {
            opfStr = opfStr.replace(action.beforeSnippet, action.afterSnippet);
            entriesMap.set(targetFile, Buffer.from(opfStr, "utf-8"));
            appliedActions.push(action.id);
          }
        }
      }
    }

    // 3. Assemble and write canonical zip to staging file
    const zipEntries: ZipOutputEntry[] = [];
    for (const [name, contents] of entriesMap.entries()) {
      zipEntries.push({
        name,
        contents,
        isStored: name === "mimetype",
      });
    }

    const repairedBuffer = buildCanonicalEpubZip(zipEntries);
    await writeFile(stagingPath, repairedBuffer);

    // 4. Re-inspection verification (ADR 0008)
    const postReport = await inspectEpubHealth(stagingPath, {
      toolVersion: options.toolVersion,
    });

    // Ensure no new fatal or error findings were introduced
    const preFatalOrError = preReport.findings.filter(
      (f) => f.severity === "fatal" || f.severity === "error",
    ).length;
    const postFatalOrError = postReport.findings.filter(
      (f) => f.severity === "fatal" || f.severity === "error",
    ).length;

    if (postFatalOrError > preFatalOrError) {
      // Abort! Regression detected
      await safeUnlink(stagingPath);
      return {
        success: false,
        sourcePath,
        actionsApplied: [],
        preHealthReport: preReport,
        postHealthReport: postReport,
        error: `Repair aborted: regression detected. Post-repair errors (${postFatalOrError}) exceeded pre-repair errors (${preFatalOrError}).`,
      };
    }

    // 5. Commit: atomic move to final output path
    await rename(stagingPath, finalOutputPath);

    // 6. Optional provenance sidecar
    if (options.writeProvenance) {
      const sourceBuf = await readFile(sourcePath);
      const outputBuf = await readFile(finalOutputPath);
      const provenance: RepairProvenance = {
        toolVersion: options.toolVersion ?? "0.1.0",
        timestamp: new Date().toISOString(),
        sourceSha256: sha256(sourceBuf),
        outputSha256: sha256(outputBuf),
        appliedRuleIds: plan.actions.map((a) => a.ruleId),
      };
      await writeFile(
        `${finalOutputPath}.provenance.json`,
        JSON.stringify(provenance, null, 2),
        "utf-8",
      );
    }

    return {
      success: true,
      sourcePath,
      outputPath: finalOutputPath,
      actionsApplied: appliedActions,
      preHealthReport: preReport,
      postHealthReport: postReport,
    };
  } catch (err) {
    await safeUnlink(stagingPath);
    return {
      success: false,
      sourcePath,
      actionsApplied: [],
      preHealthReport: preReport,
      error: `Repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function readZipEntry(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Buffer> {
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function formatTimestamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}
