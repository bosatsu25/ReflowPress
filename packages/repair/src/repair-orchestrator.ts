import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, link, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  openZipArchive,
  readEntryBuffer,
  type EpubLoaderLimits,
} from "@reflowpress/epub";
import {
  computeReportSummary,
  inspectEpubHealth,
  resolveEpubArchiveLimits,
  type HealthReport,
  type QualityFinding,
} from "@reflowpress/quality";
import { REFLOWPRESS_VERSION } from "@reflowpress/core";
import type {
  RepairManifestItemTarget,
  RepairPlan,
  RepairProvenance,
  RepairResult,
} from "./models.js";
import { buildCanonicalEpubZip, type ZipOutputEntry } from "./rewriter.js";

export interface ExecuteRepairOptions {
  readonly outputDir?: string | undefined;
  readonly outputPath?: string | undefined;
  readonly writeProvenance?: boolean | undefined;
  readonly toolVersion?: string | undefined;
  /**
   * Archive resource limits enforced while reading the source publication.
   * Defaults to the EPUB loader's DEFAULT_LOADER_LIMITS.
   */
  readonly limits?: Partial<EpubLoaderLimits> | undefined;
}

/** Alternative generated output names tried when the first one is taken. */
const MAX_GENERATED_NAME_ATTEMPTS = 100;

class RepairInputError extends Error {
  // A `code` property makes the epub archive helpers rethrow this error as-is.
  constructor(
    readonly code: "REPAIR_LIMIT_EXCEEDED" | "REPAIR_UNREADABLE_ARCHIVE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepairInputError";
  }
}

export async function executeRepair(
  sourcePath: string,
  plan: RepairPlan,
  options: ExecuteRepairOptions = {},
): Promise<RepairResult> {
  const limits = resolveEpubArchiveLimits(options.limits);
  let preReport: HealthReport | undefined;
  let stagingPath: string | undefined;

  try {
    preReport = await inspectEpubHealth(sourcePath, {
      toolVersion: options.toolVersion,
      limits,
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

    // Determine the output path (or, for generated names, the candidates).
    const outputCandidates = resolveOutputCandidates(sourcePath, options);
    stagingPath = `${outputCandidates[0]}.tmp-${randomUUID()}`;

    // 1. Read existing entries from the source ZIP within the loader limits
    const source = await readSourceEntries(sourcePath, limits);
    const entriesMap = source.entries;
    let opfFilePath = source.opfFilePath;

    const appliedActions: string[] = [];
    // Media-type fixes are batched per OPF so it is scanned and rebuilt once,
    // however many items need fixing.
    const mediaTypeFixes = new Map<
      string,
      { actionId: string; target: RepairManifestItemTarget }[]
    >();

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
        if (opfFilePath && isXmlText(opfFilePath)) {
          const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${escapeXmlAttribute(opfFilePath)}" media-type="application/oebps-package+xml"/>
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
        if (targetFile && action.manifestItem) {
          const fixes = mediaTypeFixes.get(targetFile) ?? [];
          fixes.push({ actionId: action.id, target: action.manifestItem });
          mediaTypeFixes.set(targetFile, fixes);
        }
      }
    }

    for (const [targetFile, fixes] of mediaTypeFixes) {
      const opfBytes = entriesMap.get(targetFile);
      if (!opfBytes) continue;
      const result = setManifestItemMediaTypes(
        opfBytes,
        fixes.map((fix) => fix.target),
      );
      if (!result) continue;
      entriesMap.set(targetFile, result.opf);
      for (const fix of fixes) {
        if (result.appliedIds.has(fix.target.id)) {
          appliedActions.push(fix.actionId);
        }
      }
    }

    // 3. Assemble and write canonical zip to a new, exclusively created staging file
    const zipEntries: ZipOutputEntry[] = [];
    for (const [name, contents] of entriesMap.entries()) {
      zipEntries.push({
        name,
        contents,
        isStored: name === "mimetype",
      });
    }

    const repairedBuffer = buildCanonicalEpubZip(zipEntries);
    await writeFile(stagingPath, repairedBuffer, { flag: "wx" });

    // 4. Re-inspection verification (ADR 0008)
    const postReport = await inspectEpubHealth(stagingPath, {
      toolVersion: options.toolVersion,
      limits,
    });

    // Ensure no new fatal or error findings were introduced
    const preFatalOrError = preReport.findings.filter(
      (f) => f.severity === "fatal" || f.severity === "error",
    ).length;
    const postFatalOrError = postReport.findings.filter(
      (f) => f.severity === "fatal" || f.severity === "error",
    ).length;

    if (postFatalOrError > preFatalOrError) {
      // Abort! Regression detected (the staging file is removed below)
      return {
        success: false,
        sourcePath,
        actionsApplied: [],
        preHealthReport: preReport,
        postHealthReport: postReport,
        error: `Repair aborted: regression detected. Post-repair errors (${postFatalOrError}) exceeded pre-repair errors (${preFatalOrError}).`,
      };
    }

    // 5. Optional provenance sidecar content
    let provenanceJson: string | undefined;
    if (options.writeProvenance) {
      const provenance: RepairProvenance = {
        toolVersion: options.toolVersion ?? REFLOWPRESS_VERSION,
        timestamp: new Date().toISOString(),
        sourceSha256: await sha256File(sourcePath, limits.maxArchiveBytes),
        outputSha256: sha256(repairedBuffer),
        appliedRuleIds: plan.actions.map((a) => a.ruleId),
      };
      provenanceJson = JSON.stringify(provenance, null, 2);
    }

    // 6. Commit without ever replacing an existing file or following a link
    const finalOutputPath = await commitOutput(
      stagingPath,
      outputCandidates,
      provenanceJson,
    );

    return {
      success: true,
      sourcePath,
      outputPath: finalOutputPath,
      actionsApplied: appliedActions,
      preHealthReport: preReport,
      postHealthReport: postReport,
    };
  } catch (err) {
    return {
      success: false,
      sourcePath,
      actionsApplied: [],
      preHealthReport:
        preReport ??
        failedInspectionReport(sourcePath, err, options.toolVersion),
      error: `Repair failed: ${describeError(err)}`,
    };
  } finally {
    if (stagingPath) await safeUnlink(stagingPath);
  }
}

/**
 * Reads every entry of the source archive while enforcing the loader limits:
 * archive size, entry count and entry names are checked when the archive is
 * opened, and declared entry sizes are checked against the per-entry and total
 * limits before anything is decompressed. readEntryBuffer then rejects entries
 * whose actual size or CRC differs, so memory stays bounded by the limits.
 */
async function readSourceEntries(
  sourcePath: string,
  limits: EpubLoaderLimits,
): Promise<{ entries: Map<string, Buffer>; opfFilePath: string | undefined }> {
  const { archive, entries } = await openZipArchive(
    sourcePath,
    limits,
    (message, cause) =>
      new RepairInputError("REPAIR_UNREADABLE_ARCHIVE", message, { cause }),
  );

  try {
    let totalBytes = 0;
    for (const [name, entry] of entries) {
      if (entry.uncompressedSize > limits.maxResourceBytes) {
        throw new RepairInputError(
          "REPAIR_LIMIT_EXCEEDED",
          `Archive entry '${name}' declares ${entry.uncompressedSize} uncompressed bytes, exceeding the ${limits.maxResourceBytes}-byte per-entry limit.`,
        );
      }
      totalBytes += entry.uncompressedSize;
      if (totalBytes > limits.maxTotalLoadedBytes) {
        throw new RepairInputError(
          "REPAIR_LIMIT_EXCEEDED",
          `The archive entries exceed the total uncompressed size limit of ${limits.maxTotalLoadedBytes} bytes.`,
        );
      }
    }

    const contents = new Map<string, Buffer>();
    let opfFilePath: string | undefined;
    for (const [name, entry] of entries) {
      const buffer = await readEntryBuffer(
        archive,
        entry,
        limits.maxResourceBytes,
        (message, cause) =>
          new RepairInputError(
            "REPAIR_UNREADABLE_ARCHIVE",
            `Archive entry '${name}': ${message}`,
            { cause },
          ),
      );
      contents.set(name, buffer);
      if (name.endsWith(".opf")) {
        opfFilePath = name;
      }
    }
    return { entries: contents, opfFilePath };
  } finally {
    archive.close();
  }
}

function resolveOutputCandidates(
  sourcePath: string,
  options: ExecuteRepairOptions,
): string[] {
  if (options.outputPath) {
    // An explicit output path is used as-is and never overwritten.
    return [options.outputPath];
  }

  const parsed = path.parse(sourcePath);
  const directory = options.outputDir ?? parsed.dir;
  const baseName = `${parsed.name}_repaired_${formatTimestamp(new Date())}`;
  const extension = parsed.ext || ".epub";
  const candidates: string[] = [];
  for (let attempt = 1; attempt <= MAX_GENERATED_NAME_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    candidates.push(path.join(directory, `${baseName}${suffix}${extension}`));
  }
  return candidates;
}

/**
 * Publishes the staging file under the first candidate name that does not
 * exist yet, together with its provenance sidecar. Both are created
 * exclusively, so an existing file or symbolic link is never replaced or
 * followed; if the sidecar cannot be created the output is withdrawn again.
 */
async function commitOutput(
  stagingPath: string,
  candidates: readonly string[],
  provenanceJson: string | undefined,
): Promise<string> {
  let conflict: string | undefined;

  for (const candidate of candidates) {
    try {
      await publishExclusive(stagingPath, candidate);
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
      conflict = candidate;
      continue;
    }

    if (provenanceJson !== undefined) {
      const provenancePath = `${candidate}.provenance.json`;
      try {
        await writeFile(provenancePath, provenanceJson, {
          encoding: "utf-8",
          flag: "wx",
        });
      } catch (err) {
        await safeUnlink(candidate);
        if (!isAlreadyExistsError(err)) {
          // We created the sidecar before the write failed (e.g. ENOSPC);
          // an EEXIST sidecar belongs to someone else and is left alone.
          await safeUnlink(provenancePath);
          throw err;
        }
        conflict = provenancePath;
        continue;
      }
    }

    return candidate;
  }

  throw new Error(
    candidates.length === 1
      ? `Refusing to overwrite existing file: ${conflict ?? candidates[0]}`
      : `No unused output file name is available (last conflict: ${conflict ?? candidates[0]}).`,
  );
}

/** Creates `destination` with the staging file's contents, failing with EEXIST if it exists. */
async function publishExclusive(
  source: string,
  destination: string,
): Promise<void> {
  try {
    // link(2) fails with EEXIST instead of replacing the destination.
    await link(source, destination);
    return;
  } catch (err) {
    if (isAlreadyExistsError(err)) throw err;
    // Filesystems without hard links: fall back to an exclusive copy.
  }
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
}

/**
 * Sets the media-type of each targeted manifest `<item>`, identified by its id
 * and declared media-type, in a single scan. The OPF is edited in place
 * (byte-for-byte outside the attribute values) rather than re-serialized.
 * Items whose id appears more than once are ambiguous and left untouched.
 * Returns undefined when nothing was changed.
 */
function setManifestItemMediaTypes(
  opf: Buffer,
  targets: readonly RepairManifestItemTarget[],
): { opf: Buffer; appliedIds: Set<string> } | undefined {
  // latin1 maps each byte to one code unit, so ASCII markup can be scanned and
  // the untouched bytes round-trip exactly, whatever the document encoding.
  const xml = opf.toString("latin1");
  const toLatin1 = (value: string) =>
    Buffer.from(value, "utf-8").toString("latin1");

  const byId = new Map<
    string,
    { target: RepairManifestItemTarget; declared: string; replacement: string }
  >();
  for (const target of targets) {
    if (!isXmlText(target.expectedMediaType)) continue;
    byId.set(toLatin1(target.id), {
      target,
      declared: toLatin1(target.declaredMediaType),
      replacement: toLatin1(escapeXmlAttribute(target.expectedMediaType)),
    });
  }
  if (byId.size === 0) return undefined;

  const idCounts = new Map<string, number>();
  const candidates: { id: string; span: XmlAttributeSpan }[] = [];
  scanManifestItemTags(xml, (attributes) => {
    const idSpan = attributes.get("id");
    if (!idSpan) return;
    const id = xml.slice(idSpan.valueStart, idSpan.valueEnd);
    const entry = byId.get(id);
    if (!entry) return;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const mediaTypeSpan = attributes.get("media-type");
    if (
      mediaTypeSpan &&
      xml.slice(mediaTypeSpan.valueStart, mediaTypeSpan.valueEnd) ===
        entry.declared
    ) {
      candidates.push({ id, span: mediaTypeSpan });
    }
  });

  const edits = candidates.filter(({ id }) => idCounts.get(id) === 1);
  if (edits.length === 0) return undefined;

  let result = "";
  let last = 0;
  const appliedIds = new Set<string>();
  for (const { id, span } of edits) {
    const entry = byId.get(id)!;
    result += xml.slice(last, span.valueStart) + entry.replacement;
    last = span.valueEnd;
    appliedIds.add(entry.target.id);
  }
  result += xml.slice(last);
  return { opf: Buffer.from(result, "latin1"), appliedIds };
}

interface XmlAttributeSpan {
  readonly valueStart: number;
  readonly valueEnd: number;
}

/**
 * Minimal linear-time scanner that reports the attributes of every `<item>`
 * start tag inside `<manifest>`. Comments, CDATA sections, processing
 * instructions and DOCTYPE declarations are skipped; scanning stops at the
 * first malformed construct.
 */
function scanManifestItemTags(
  xml: string,
  visit: (attributes: ReadonlyMap<string, XmlAttributeSpan>) => void,
): void {
  let cursor = 0;
  let inManifest = false;

  while (cursor < xml.length) {
    const lt = xml.indexOf("<", cursor);
    if (lt === -1) return;

    const skipTo = skipNonElementMarkup(xml, lt);
    if (skipTo === -1) return;
    if (skipTo !== undefined) {
      cursor = skipTo;
      continue;
    }

    const isEndTag = xml.charCodeAt(lt + 1) === 0x2f; // "/"
    let i = lt + (isEndTag ? 2 : 1);
    const nameStart = i;
    while (i < xml.length && isXmlNameChar(xml.charCodeAt(i))) i += 1;
    const name = xml.slice(nameStart, i);

    if (isEndTag) {
      const end = xml.indexOf(">", i);
      if (end === -1) return;
      if (name === "manifest") inManifest = false;
      cursor = end + 1;
      continue;
    }

    const attributes = new Map<string, XmlAttributeSpan>();
    let selfClosing = false;
    for (;;) {
      while (i < xml.length && isXmlWhitespace(xml.charCodeAt(i))) i += 1;
      if (i >= xml.length) return;
      const code = xml.charCodeAt(i);
      if (code === 0x3e) {
        // ">"
        i += 1;
        break;
      }
      if (code === 0x2f) {
        // "/>"
        if (xml.charCodeAt(i + 1) !== 0x3e) return;
        selfClosing = true;
        i += 2;
        break;
      }

      const attributeStart = i;
      while (i < xml.length && isXmlNameChar(xml.charCodeAt(i))) i += 1;
      if (i === attributeStart) return;
      const attributeName = xml.slice(attributeStart, i);
      while (i < xml.length && isXmlWhitespace(xml.charCodeAt(i))) i += 1;
      if (xml.charCodeAt(i) !== 0x3d) return; // "="
      i += 1;
      while (i < xml.length && isXmlWhitespace(xml.charCodeAt(i))) i += 1;
      const quote = xml[i];
      if (quote !== '"' && quote !== "'") return;
      const valueEnd = xml.indexOf(quote, i + 1);
      if (valueEnd === -1) return;
      if (!attributes.has(attributeName)) {
        attributes.set(attributeName, { valueStart: i + 1, valueEnd });
      }
      i = valueEnd + 1;
    }

    if (name === "manifest" && !selfClosing) {
      inManifest = true;
    } else if (name === "item" && inManifest) {
      visit(attributes);
    }
    cursor = i;
  }
}

/**
 * For markup at `lt` that is not an element tag, returns the index just after
 * it (or -1 if it is unterminated). Returns undefined for element tags.
 */
function skipNonElementMarkup(xml: string, lt: number): number | undefined {
  const terminate = (end: number, length: number): number =>
    end === -1 ? -1 : end + length;

  if (xml.startsWith("<!--", lt)) {
    return terminate(xml.indexOf("-->", lt + 4), 3);
  }
  if (xml.startsWith("<![CDATA[", lt)) {
    return terminate(xml.indexOf("]]>", lt + 9), 3);
  }
  if (xml.startsWith("<?", lt)) {
    return terminate(xml.indexOf("?>", lt + 2), 2);
  }
  if (xml.startsWith("<!", lt)) {
    // DOCTYPE and other declarations, possibly with an internal subset.
    const close = xml.indexOf(">", lt + 2);
    if (close === -1) return -1;
    const subset = xml.indexOf("[", lt + 2);
    if (subset !== -1 && subset < close) {
      const subsetEnd = xml.indexOf("]", subset + 1);
      if (subsetEnd === -1) return -1;
      return terminate(xml.indexOf(">", subsetEnd + 1), 1);
    }
    return close + 1;
  }
  return undefined;
}

function isXmlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isXmlNameChar(code: number): boolean {
  return (
    !Number.isNaN(code) &&
    !isXmlWhitespace(code) &&
    code !== 0x3d && // =
    code !== 0x3e && // >
    code !== 0x2f && // /
    code !== 0x3c && // <
    code !== 0x22 && // "
    code !== 0x27 // '
  );
}

/** True when every character is allowed in XML 1.0 documents. */
function isXmlText(value: string): boolean {
  return !/[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/u.test(value);
}

const XML_ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

function escapeXmlAttribute(value: string): string {
  return value.replace(
    /[&<>"'\t\n\r]/g,
    (character) => XML_ATTRIBUTE_ESCAPES[character] ?? character,
  );
}

function failedInspectionReport(
  sourcePath: string,
  err: unknown,
  toolVersion: string | undefined,
): HealthReport {
  const findings: QualityFinding[] = [
    {
      ruleId: "EPUB-CONTAINER-006",
      severity: "fatal",
      category: "container",
      message: `Pre-repair inspection failed: ${describeError(err)}`,
      repairability: "none",
    },
  ];
  return {
    publicationPath: sourcePath,
    publicationType: "epub",
    inspectedAt: new Date().toISOString(),
    durationMs: 1,
    findings,
    summary: computeReportSummary(findings),
    rulesExecuted: [],
    rulesSkipped: [],
    toolVersion: toolVersion ?? REFLOWPRESS_VERSION,
  };
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error
    ? `${err.message} (${err.cause.message})`
    : err.message;
}

function isAlreadyExistsError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
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

/**
 * Hashes a regular file of at most `maxBytes`, reading through one handle so
 * a path swapped for a device or FIFO cannot make the read endless.
 */
async function sha256File(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) {
      throw new Error(
        `Source changed during repair or is not a regular file: ${filePath}`,
      );
    }
    const hash = createHash("sha256");
    if (info.size > 0) {
      for await (const chunk of handle.createReadStream({
        start: 0,
        end: info.size - 1,
        autoClose: false,
      })) {
        hash.update(chunk as Buffer);
      }
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore
  }
}
