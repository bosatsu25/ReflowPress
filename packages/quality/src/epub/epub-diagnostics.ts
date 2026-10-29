import { stat } from "node:fs/promises";
import { DOMParser, type Document } from "@xmldom/xmldom";
import type { Entry } from "yauzl";
import {
  computeReportSummary,
  deduplicateFindings,
  type HealthReport,
  type QualityFinding,
  type PublicationMediaOverlaysReport,
  type Severity,
} from "../models.js";
import {
  extractReferencesFromCss,
  extractReferencesFromXml,
  resolveInternalPath,
} from "./resource-graph.js";
import {
  DEFAULT_LOADER_LIMITS,
  openZipArchive,
  parseSmilDocument,
  readEntryBuffer,
  type EpubLoaderLimits,
  type MediaOverlayDocument,
  type OpenedZipArchive,
} from "@reflowpress/epub";
import { REFLOWPRESS_VERSION } from "@reflowpress/core";

const KNOWN_MIME_TYPES: Record<string, string> = {
  ".xhtml": "application/xhtml+xml",
  ".html": "application/xhtml+xml",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ncx": "application/x-dtbncx+xml",
  ".js": "text/javascript",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".smil": "application/smil+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
};

/**
 * Maximum number of distinct findings reported per rule. Attacker-controlled
 * markup can otherwise produce millions of unique findings (for example one
 * broken reference per element) and exhaust memory while building the report.
 */
const MAX_FINDINGS_PER_RULE = 1000;

/** Upper bound on the length of attacker-controlled text quoted in findings. */
const MAX_QUOTED_TEXT_CHARS = 512;

interface ZipEntryInfo {
  readonly entry: Entry;
  readonly index: number;
}

export interface EpubHealthInspectionOptions {
  readonly toolVersion?: string | undefined;
  /**
   * Overrides for the archive resource limits. Defaults to the EPUB loader's
   * DEFAULT_LOADER_LIMITS so inspection accepts exactly what the loader accepts.
   */
  readonly limits?: Partial<EpubLoaderLimits> | undefined;
}

/**
 * Resolves archive resource limits, falling back to DEFAULT_LOADER_LIMITS for
 * any override that is missing or not a positive safe integer.
 */
export function resolveEpubArchiveLimits(
  overrides?: Partial<EpubLoaderLimits> | undefined,
): EpubLoaderLimits {
  const resolved: { -readonly [K in keyof EpubLoaderLimits]: number } = {
    ...DEFAULT_LOADER_LIMITS,
  };
  if (overrides) {
    for (const key of Object.keys(resolved) as (keyof EpubLoaderLimits)[]) {
      const value = overrides[key];
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value > 0
      ) {
        resolved[key] = value;
      }
    }
  }
  return resolved;
}

class ArchiveInspectionError extends Error {
  // A `code` property makes the epub archive helpers rethrow this error as-is
  // instead of wrapping it in a generic one.
  readonly code = "EPUB_ARCHIVE_INSPECTION";

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArchiveInspectionError";
  }
}

const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

/**
 * Collects findings while bounding memory: duplicates are dropped on insertion
 * and at most `maxPerRule` distinct findings are kept per rule. Overflow is
 * summarized by a single finding per rule.
 */
class BoundedFindingList {
  private readonly items: QualityFinding[] = [];
  private readonly signatures = new Set<string>();
  private readonly perRule = new Map<string, number>();
  private readonly overflow = new Map<
    string,
    { mostSevere: QualityFinding; count: number }
  >();

  constructor(private readonly maxPerRule: number) {}

  push(finding: QualityFinding): void {
    const signature = `${finding.ruleId}::${finding.location?.path ?? ""}::${finding.location?.line ?? ""}::${finding.message}`;
    if (this.signatures.has(signature)) return;

    const count = this.perRule.get(finding.ruleId) ?? 0;
    if (count < this.maxPerRule) {
      this.perRule.set(finding.ruleId, count + 1);
      this.signatures.add(signature);
      this.items.push(finding);
      return;
    }

    const overflow = this.overflow.get(finding.ruleId);
    if (!overflow) {
      this.overflow.set(finding.ruleId, { mostSevere: finding, count: 1 });
    } else {
      overflow.count += 1;
      if (
        SEVERITY_RANK[finding.severity] >
        SEVERITY_RANK[overflow.mostSevere.severity]
      ) {
        overflow.mostSevere = finding;
      }
    }
  }

  toArray(): QualityFinding[] {
    const result = [...this.items];
    for (const [ruleId, { mostSevere, count }] of this.overflow) {
      result.push({
        ruleId,
        severity: mostSevere.severity,
        category: mostSevere.category,
        message: `${count} additional ${ruleId} occurrence(s) were not listed because the limit of ${this.maxPerRule} findings per rule was reached.`,
        evidence: [
          { key: "suppressedCount", value: count },
          { key: "perRuleLimit", value: this.maxPerRule },
        ],
        repairability: mostSevere.repairability,
      });
    }
    return result;
  }
}

export async function inspectEpubHealth(
  sourcePath: string,
  options?: EpubHealthInspectionOptions | undefined,
): Promise<HealthReport> {
  const startTime = Date.now();
  const findings = new BoundedFindingList(MAX_FINDINGS_PER_RULE);
  const rulesExecuted = new Set<string>();
  const rulesSkipped: string[] = [];
  const limits = resolveEpubArchiveLimits(options?.limits);

  const finish = (
    mediaOverlays?: PublicationMediaOverlaysReport | undefined,
  ): HealthReport =>
    finalizeReport(
      sourcePath,
      findings.toArray(),
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
      mediaOverlays,
    );

  let fileStat;
  try {
    fileStat = await stat(sourcePath);
  } catch (err) {
    findings.push({
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: `Cannot access publication file: ${describeError(err)}`,
      repairability: "none",
    });
    return finish();
  }

  if (!fileStat.isFile() || fileStat.size === 0) {
    findings.push({
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: "Publication file is empty or not a regular file.",
      repairability: "none",
    });
    return finish();
  }

  // Archive-level safety checks shared with the strict EPUB loader.
  rulesExecuted.add("EPUB-SEC-001");
  rulesExecuted.add("EPUB-SEC-003");
  rulesExecuted.add("EPUB-CONTAINER-006");

  if (fileStat.size > limits.maxArchiveBytes) {
    findings.push({
      ruleId: "EPUB-SEC-003",
      severity: "fatal",
      category: "security",
      message: `Publication archive is ${fileStat.size} bytes, which exceeds the ${limits.maxArchiveBytes}-byte inspection limit; it was not opened.`,
      evidence: [
        { key: "archiveBytes", value: fileStat.size },
        { key: "limitBytes", value: limits.maxArchiveBytes },
      ],
      repairability: "none",
    });
    return finish();
  }

  let opened: OpenedZipArchive;
  try {
    opened = await openZipArchive(
      sourcePath,
      limits,
      (message, cause) => new ArchiveInspectionError(message, cause),
    );
  } catch (err) {
    findings.push(classifyArchiveOpenFailure(err, limits));
    return finish();
  }

  const { archive, entries } = opened;
  let totalLoadedBytes = 0;
  let totalLimitReached = false;

  /**
   * Reads one entry within the per-entry limit and the running total budget.
   * Limit violations and undecodable entries become findings; the caller
   * receives `undefined` and skips the checks that need the content.
   */
  const readBytes = async (
    entryPath: string,
    entry: Entry,
    maxBytes: number,
  ): Promise<Buffer | undefined> => {
    if (totalLimitReached) return undefined;

    if (entry.uncompressedSize > maxBytes) {
      findings.push({
        ruleId: "EPUB-SEC-003",
        severity: "fatal",
        category: "security",
        message: `Archive entry '${entryPath}' declares ${entry.uncompressedSize} uncompressed bytes, exceeding the ${maxBytes}-byte limit for this document type; it was not inspected.`,
        location: { path: entryPath },
        evidence: [
          { key: "declaredBytes", value: entry.uncompressedSize },
          { key: "limitBytes", value: maxBytes },
        ],
        repairability: "none",
      });
      return undefined;
    }

    if (
      totalLoadedBytes + entry.uncompressedSize >
      limits.maxTotalLoadedBytes
    ) {
      totalLimitReached = true;
      findings.push({
        ruleId: "EPUB-SEC-003",
        severity: "fatal",
        category: "security",
        message: `Inspection stopped before reading '${entryPath}': the inspected entries would exceed the total decompressed-size limit of ${limits.maxTotalLoadedBytes} bytes.`,
        location: { path: entryPath },
        evidence: [
          { key: "loadedBytes", value: totalLoadedBytes },
          { key: "limitBytes", value: limits.maxTotalLoadedBytes },
        ],
        repairability: "none",
      });
      return undefined;
    }

    // The declared size is authoritative: readEntryBuffer aborts as soon as the
    // stream yields more bytes and rejects entries whose actual size differs.
    totalLoadedBytes += entry.uncompressedSize;
    try {
      return await readEntryBuffer(
        archive,
        entry,
        maxBytes,
        (message, cause) => new ArchiveInspectionError(message, cause),
      );
    } catch (err) {
      findings.push({
        ruleId: "EPUB-CONTAINER-006",
        severity: "fatal",
        category: "container",
        message: `Archive entry '${entryPath}' could not be read safely: ${describeError(err)}`,
        location: { path: entryPath },
        repairability: "none",
      });
      return undefined;
    }
  };

  try {
    const entryMap = new Map<string, ZipEntryInfo>();
    let entryIndex = 0;
    for (const [name, entry] of entries) {
      entryMap.set(name, { entry, index: entryIndex });
      entryIndex += 1;
    }
    const firstEntryName = entries.keys().next().value;

    // 1. Mimetype check
    rulesExecuted.add("EPUB-CONTAINER-001");
    rulesExecuted.add("EPUB-CONTAINER-002");
    rulesExecuted.add("EPUB-CONTAINER-003");

    const mimetypeEntryInfo = entryMap.get("mimetype");
    if (!mimetypeEntryInfo) {
      findings.push({
        ruleId: "EPUB-CONTAINER-001",
        severity: "fatal",
        category: "container",
        message: "Required 'mimetype' file is missing from archive.",
        location: { path: "mimetype" },
        repairability: "safe-auto",
      });
    } else {
      const mimetypeBuffer = await readBytes(
        "mimetype",
        mimetypeEntryInfo.entry,
        limits.maxMetadataDocumentBytes,
      );
      if (mimetypeBuffer) {
        const mimetypeText = mimetypeBuffer.toString("utf-8");

        if (mimetypeText !== "application/epub+zip") {
          const quoted = truncateText(mimetypeText);
          findings.push({
            ruleId: "EPUB-CONTAINER-002",
            severity: "error",
            category: "container",
            message: `Invalid mimetype content: expected 'application/epub+zip', found '${quoted}'.`,
            location: { path: "mimetype" },
            evidence: [{ key: "actualMimetype", value: quoted }],
            repairability: "safe-auto",
          });
        }
      }

      const isFirst =
        mimetypeEntryInfo.index === 0 && firstEntryName === "mimetype";
      const isStored = mimetypeEntryInfo.entry.compressionMethod === 0;

      if (!isFirst || !isStored) {
        findings.push({
          ruleId: "EPUB-CONTAINER-003",
          severity: "warning",
          category: "container",
          message: `Mimetype file must be uncompressed STORE and the first entry in archive (firstEntry=${isFirst}, compression=${mimetypeEntryInfo.entry.compressionMethod}).`,
          location: { path: "mimetype" },
          evidence: [
            { key: "isFirst", value: isFirst },
            {
              key: "compressionMethod",
              value: mimetypeEntryInfo.entry.compressionMethod,
            },
          ],
          repairability: "safe-auto",
        });
      }
    }

    // 2. Container.xml check
    rulesExecuted.add("EPUB-CONTAINER-004");
    rulesExecuted.add("EPUB-CONTAINER-005");

    const containerEntryInfo = entryMap.get("META-INF/container.xml");
    let opfPath: string | undefined;

    if (!containerEntryInfo) {
      findings.push({
        ruleId: "EPUB-CONTAINER-004",
        severity: "fatal",
        category: "container",
        message:
          "Mandatory 'META-INF/container.xml' descriptor file is missing.",
        location: { path: "META-INF/container.xml" },
        repairability: "safe-auto",
      });
    } else {
      const containerBuffer = await readBytes(
        "META-INF/container.xml",
        containerEntryInfo.entry,
        limits.maxMetadataDocumentBytes,
      );
      if (containerBuffer) {
        const { doc, error } = parseXml(containerBuffer.toString("utf-8"));
        if (error || !doc) {
          findings.push({
            ruleId: "EPUB-CONTAINER-005",
            severity: "error",
            category: "container",
            message: `Malformed META-INF/container.xml: ${error ?? "unknown XML error"}`,
            location: { path: "META-INF/container.xml" },
            repairability: "manual",
          });
        } else {
          const rootfiles = doc.getElementsByTagName("rootfile");
          for (let i = 0; i < rootfiles.length; i += 1) {
            const rf = rootfiles[i];
            const fullPath = rf?.getAttribute("full-path");
            const mediaType = rf?.getAttribute("media-type");
            if (mediaType === "application/oebps-package+xml" && fullPath) {
              opfPath = fullPath;
              break;
            }
          }
          if (!opfPath && rootfiles.length > 0) {
            opfPath = rootfiles[0]?.getAttribute("full-path") ?? undefined;
          }

          if (!opfPath) {
            findings.push({
              ruleId: "EPUB-CONTAINER-005",
              severity: "error",
              category: "container",
              message:
                "META-INF/container.xml does not contain a valid <rootfile> with full-path.",
              location: { path: "META-INF/container.xml" },
              repairability: "manual",
            });
          }
        }
      }
    }

    // If container.xml was missing or invalid, try to find an OPF candidate in the archive
    if (!opfPath) {
      for (const [name] of entryMap.entries()) {
        if (name.endsWith(".opf")) {
          opfPath = name;
          break;
        }
      }
    }

    // 3. OPF Package document check
    rulesExecuted.add("EPUB-PACKAGE-001");
    rulesExecuted.add("EPUB-PACKAGE-002");
    rulesExecuted.add("EPUB-PACKAGE-003");

    const opfEntryInfo = opfPath ? entryMap.get(opfPath) : undefined;
    if (!opfPath || !opfEntryInfo) {
      const quotedOpfPath = opfPath ? truncateText(opfPath) : undefined;
      findings.push({
        ruleId: "EPUB-PACKAGE-001",
        severity: "fatal",
        category: "package",
        message: `OPF package document '${quotedOpfPath ?? "unknown"}' not found in archive.`,
        location: { path: quotedOpfPath ?? "META-INF/container.xml" },
        repairability: "manual",
      });
      return finish();
    }

    const opfBuffer = await readBytes(
      opfPath,
      opfEntryInfo.entry,
      limits.maxMetadataDocumentBytes,
    );
    if (!opfBuffer) {
      // A fatal limit or decoding finding has already been recorded.
      return finish();
    }
    const { doc: opfDoc, error: opfXmlError } = parseXml(
      opfBuffer.toString("utf-8"),
    );

    if (opfXmlError || !opfDoc) {
      findings.push({
        ruleId: "EPUB-PACKAGE-002",
        severity: "fatal",
        category: "package",
        message: `Invalid OPF XML syntax in '${opfPath}': ${opfXmlError ?? "XML parse error"}`,
        location: { path: opfPath },
        repairability: "manual",
      });
      return finish();
    }

    const packageElem = opfDoc.getElementsByTagName("package")[0];
    if (!packageElem) {
      findings.push({
        ruleId: "EPUB-PACKAGE-003",
        severity: "error",
        category: "package",
        message: "Missing root <package> element in OPF.",
        location: { path: opfPath },
        repairability: "manual",
      });
    }

    // 4. Metadata check
    rulesExecuted.add("EPUB-META-001");
    rulesExecuted.add("EPUB-META-002");
    rulesExecuted.add("EPUB-META-003");

    const metadataElem = opfDoc.getElementsByTagName("metadata")[0];
    if (!metadataElem) {
      findings.push({
        ruleId: "EPUB-META-001",
        severity: "error",
        category: "metadata",
        message: "Missing <metadata> element in OPF.",
        location: { path: opfPath },
        repairability: "manual",
      });
    } else {
      const titles = metadataElem.getElementsByTagName("dc:title");
      if (titles.length === 0 || !titles[0]?.textContent?.trim()) {
        findings.push({
          ruleId: "EPUB-META-001",
          severity: "error",
          category: "metadata",
          message: "Missing required <dc:title> in package metadata.",
          location: { path: opfPath },
          repairability: "manual",
        });
      }

      const langs = metadataElem.getElementsByTagName("dc:language");
      if (langs.length === 0 || !langs[0]?.textContent?.trim()) {
        findings.push({
          ruleId: "EPUB-META-002",
          severity: "warning",
          category: "metadata",
          message: "Missing recommended <dc:language> in package metadata.",
          location: { path: opfPath },
          repairability: "manual",
        });
      }

      const idents = metadataElem.getElementsByTagName("dc:identifier");
      if (idents.length === 0 || !idents[0]?.textContent?.trim()) {
        findings.push({
          ruleId: "EPUB-META-003",
          severity: "warning",
          category: "metadata",
          message: "Missing recommended <dc:identifier> in package metadata.",
          location: { path: opfPath },
          repairability: "manual",
        });
      }
    }

    // 5. Manifest check
    rulesExecuted.add("EPUB-MANIFEST-001");
    rulesExecuted.add("EPUB-MANIFEST-002");
    rulesExecuted.add("EPUB-MANIFEST-003");
    rulesExecuted.add("EPUB-MANIFEST-004");

    const manifestElem = opfDoc.getElementsByTagName("manifest")[0];
    const manifestItemsById = new Map<
      string,
      {
        href: string;
        mediaType: string;
        fullPath: string;
        mediaOverlay?: string | undefined;
      }
    >();
    const manifestHrefsInArchive = new Set<string>();
    const smilPaths = new Set<string>();
    const manifestOverlayRefs = new Map<string, string>();

    if (!manifestElem) {
      findings.push({
        ruleId: "EPUB-MANIFEST-001",
        severity: "fatal",
        category: "manifest",
        message: "Missing required <manifest> element in OPF.",
        location: { path: opfPath },
        repairability: "manual",
      });
    } else {
      const items = manifestElem.getElementsByTagName("item");
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const id = item?.getAttribute("id");
        const href = item?.getAttribute("href");
        const mediaType = item?.getAttribute("media-type") ?? "";
        const mediaOverlay = item?.getAttribute("media-overlay") ?? undefined;

        if (!id || !href) {
          findings.push({
            ruleId: "EPUB-MANIFEST-002",
            severity: "error",
            category: "manifest",
            message: `Manifest item at index ${i} is missing required 'id' or 'href' attribute.`,
            location: { path: opfPath },
            repairability: "manual",
          });
          continue;
        }

        const fullPath = resolveInternalPath(opfPath, href);
        manifestItemsById.set(id, { href, mediaType, fullPath, mediaOverlay });
        manifestHrefsInArchive.add(fullPath);

        if (mediaOverlay) {
          manifestOverlayRefs.set(id, mediaOverlay);
        }
        if (
          mediaType === "application/smil+xml" ||
          fullPath.toLowerCase().endsWith(".smil")
        ) {
          smilPaths.add(fullPath);
        }

        // Check if item exists in archive
        if (!entryMap.has(fullPath)) {
          findings.push({
            ruleId: "EPUB-MANIFEST-003",
            severity: "error",
            category: "manifest",
            message: `Manifest item '${id}' points to missing file: '${fullPath}'.`,
            location: { path: opfPath },
            evidence: [
              { key: "id", value: id },
              { key: "href", value: href },
              { key: "resolvedPath", value: fullPath },
            ],
            repairability: "manual",
          });
        }

        // Check media-type correctness
        const ext = getFileExtension(fullPath);
        const expectedMime = KNOWN_MIME_TYPES[ext];
        if (expectedMime && mediaType && mediaType !== expectedMime) {
          const isSafeFix = [
            ".xhtml",
            ".html",
            ".css",
            ".png",
            ".jpg",
            ".jpeg",
            ".svg",
          ].includes(ext);
          findings.push({
            ruleId: "EPUB-MANIFEST-004",
            severity: "warning",
            category: "manifest",
            message: `Manifest item '${id}' media-type mismatch: declared '${mediaType}', expected '${expectedMime}' for extension '${ext}'.`,
            location: { path: opfPath },
            evidence: [
              { key: "id", value: id },
              { key: "declaredMime", value: mediaType },
              { key: "expectedMime", value: expectedMime },
            ],
            repairability: isSafeFix ? "safe-auto" : "manual",
          });
        }
      }
    }

    // 6. Spine check
    rulesExecuted.add("EPUB-SPINE-001");
    rulesExecuted.add("EPUB-SPINE-002");
    rulesExecuted.add("EPUB-SPINE-003");

    const spineElem = opfDoc.getElementsByTagName("spine")[0];
    if (!spineElem) {
      findings.push({
        ruleId: "EPUB-SPINE-001",
        severity: "fatal",
        category: "reading-order",
        message: "Missing required <spine> element in OPF.",
        location: { path: opfPath },
        repairability: "manual",
      });
    } else {
      const itemrefs = spineElem.getElementsByTagName("itemref");
      if (itemrefs.length === 0) {
        findings.push({
          ruleId: "EPUB-SPINE-002",
          severity: "error",
          category: "reading-order",
          message: "<spine> element has 0 itemref items.",
          location: { path: opfPath },
          repairability: "manual",
        });
      } else {
        for (let i = 0; i < itemrefs.length; i += 1) {
          const idref = itemrefs[i]?.getAttribute("idref");
          if (!idref || !manifestItemsById.has(idref)) {
            findings.push({
              ruleId: "EPUB-SPINE-003",
              severity: "error",
              category: "reading-order",
              message: `Spine itemref at index ${i} references non-existent manifest id: '${idref ?? "unknown"}'.`,
              location: { path: opfPath },
              evidence: [{ key: "idref", value: idref ?? "" }],
              repairability: "manual",
            });
          }
        }
      }
    }

    // 7. Navigation document check
    rulesExecuted.add("EPUB-NAV-001");
    rulesExecuted.add("EPUB-NAV-002");
    rulesExecuted.add("EPUB-NAV-003");

    let navFound = false;
    // Check EPUB 3 nav document
    let navDocPath: string | undefined;
    if (manifestElem) {
      const items = manifestElem.getElementsByTagName("item");
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const props = item?.getAttribute("properties")?.split(/\s+/) ?? [];
        if (props.includes("nav")) {
          const href = item?.getAttribute("href");
          if (href) {
            navDocPath = resolveInternalPath(opfPath, href);
            navFound = true;
            break;
          }
        }
      }
    }

    // Fallback to EPUB 2 NCX
    if (!navFound && spineElem) {
      const tocId = spineElem.getAttribute("toc");
      if (tocId && manifestItemsById.has(tocId)) {
        navDocPath = manifestItemsById.get(tocId)!.fullPath;
        navFound = true;
      }
    }

    const navEntryInfo = navDocPath ? entryMap.get(navDocPath) : undefined;
    if (!navFound) {
      findings.push({
        ruleId: "EPUB-NAV-001",
        severity: "error",
        category: "navigation",
        message:
          "No navigation document (EPUB 3 nav doc or EPUB 2 NCX) declared.",
        location: { path: opfPath },
        repairability: "manual",
      });
    } else if (navDocPath && navEntryInfo) {
      // When the read is refused, a limit or decoding finding is recorded.
      const navBuffer = await readBytes(
        navDocPath,
        navEntryInfo.entry,
        limits.maxMetadataDocumentBytes,
      );
      const navResult = navBuffer
        ? parseXml(navBuffer.toString("utf-8"))
        : undefined;
      if (navResult && (navResult.error || !navResult.doc)) {
        findings.push({
          ruleId: "EPUB-NAV-003",
          severity: "error",
          category: "navigation",
          message: `Navigation document '${navDocPath}' has invalid XML syntax: ${navResult.error ?? "parse error"}`,
          location: { path: navDocPath },
          repairability: "manual",
        });
      } else if (navResult?.doc) {
        // Inspect links inside nav document
        const links = navResult.doc.getElementsByTagName("a");
        for (let i = 0; i < links.length; i += 1) {
          const href = links[i]?.getAttribute("href");
          if (
            href &&
            !href.startsWith("#") &&
            !href.startsWith("http://") &&
            !href.startsWith("https://")
          ) {
            const targetPath = resolveInternalPath(navDocPath, href);
            if (!entryMap.has(targetPath)) {
              findings.push({
                ruleId: "EPUB-NAV-002",
                severity: "warning",
                category: "navigation",
                message: `Navigation link '${href}' points to missing file: '${targetPath}'.`,
                location: { path: navDocPath },
                evidence: [{ key: "href", value: href }],
                repairability: "manual",
              });
            }
          }
        }
      }
    }

    // 8. Resource graph & security inspection
    rulesExecuted.add("EPUB-RESOURCE-001");
    rulesExecuted.add("EPUB-RESOURCE-002");
    rulesExecuted.add("EPUB-SEC-002");

    // Only archive entries that exist; used to classify orphans, so it never
    // needs to hold more paths than the archive has entries.
    const referencedAssets = new Set<string>();
    // Collect references from manifest-declared XHTML/CSS documents only.
    // Undeclared entries are reported as orphans without being decompressed.
    for (const entryPath of manifestHrefsInArchive) {
      const isMarkup =
        entryPath.endsWith(".xhtml") || entryPath.endsWith(".html");
      const isCss = entryPath.endsWith(".css");
      if (!isMarkup && !isCss) continue;
      const info = entryMap.get(entryPath);
      if (!info) continue;

      const buffer = await readBytes(
        entryPath,
        info.entry,
        limits.maxMarkupBytes,
      );
      if (!buffer) continue;
      const text = buffer.toString("utf-8");

      if (isMarkup) {
        // Security check: script tags or javascript: URIs
        if (text.includes("<script") || /javascript\s*:/i.test(text)) {
          findings.push({
            ruleId: "EPUB-SEC-002",
            severity: "warning",
            category: "security",
            message: `Executable script tag or javascript scheme detected in '${entryPath}'.`,
            location: { path: entryPath },
            repairability: "manual",
          });
        }
      }

      const refs = new Set(
        isMarkup
          ? extractReferencesFromXml(text)
          : extractReferencesFromCss(text),
      );
      for (const ref of refs) {
        const target = resolveInternalPath(entryPath, ref);
        if (!target) continue;
        if (entryMap.has(target)) {
          referencedAssets.add(target);
          continue;
        }
        findings.push({
          ruleId: "EPUB-RESOURCE-002",
          severity: "warning",
          category: "resource",
          message: isMarkup
            ? `Broken internal resource reference '${ref}' -> '${target}'.`
            : `Broken CSS url reference '${ref}' -> '${target}'.`,
          location: { path: entryPath },
          evidence: [
            { key: "ref", value: ref },
            { key: "resolved", value: target },
          ],
          repairability: "manual",
        });
      }
    }

    // Media Overlays & SMIL inspection
    const smilDocuments: MediaOverlayDocument[] = [];
    const missingAudioFiles = new Set<string>();

    for (const [itemId, overlayId] of manifestOverlayRefs.entries()) {
      rulesExecuted.add("EPUB-OVERLAY-002");
      const overlayItem = manifestItemsById.get(overlayId);
      if (!overlayItem) {
        findings.push({
          ruleId: "EPUB-OVERLAY-002",
          severity: "error",
          category: "resource",
          message: `Manifest item '${itemId}' references undefined media-overlay '${overlayId}'.`,
          location: { path: opfPath },
          repairability: "manual",
        });
      } else {
        smilPaths.add(overlayItem.fullPath);
      }
    }

    if (smilPaths.size > 0) {
      rulesExecuted.add("EPUB-OVERLAY-001");
      rulesExecuted.add("EPUB-OVERLAY-002");
    }

    for (const smilPath of smilPaths) {
      const smilInfo = entryMap.get(smilPath);
      if (!smilInfo) continue;
      referencedAssets.add(smilPath);

      const smilBuf = await readBytes(
        smilPath,
        smilInfo.entry,
        limits.maxMetadataDocumentBytes,
      );
      if (!smilBuf) continue;

      try {
        const smilDoc = parseSmilDocument(smilBuf.toString("utf-8"), smilPath);
        smilDocuments.push(smilDoc);

        for (const audioRef of smilDoc.audioReferences) {
          if (entryMap.has(audioRef)) {
            referencedAssets.add(audioRef);
            continue;
          }
          missingAudioFiles.add(audioRef);
          findings.push({
            ruleId: "EPUB-OVERLAY-001",
            severity: "warning",
            category: "resource",
            message: `Media Overlays audio file '${audioRef}' referenced in '${smilPath}' was not found in archive.`,
            location: { path: smilPath },
            evidence: [{ key: "audioRef", value: audioRef }],
            repairability: "manual",
          });
        }
      } catch (err) {
        findings.push({
          ruleId: "EPUB-OVERLAY-002",
          severity: "error",
          category: "resource",
          message: `Failed to parse SMIL 3.0 Media Overlay document '${smilPath}': ${describeError(err)}`,
          location: { path: smilPath },
          repairability: "manual",
        });
      }
    }

    let mediaOverlaysReport: PublicationMediaOverlaysReport | undefined =
      undefined;
    if (
      smilDocuments.length > 0 ||
      smilPaths.size > 0 ||
      manifestOverlayRefs.size > 0
    ) {
      const totalDuration = smilDocuments.reduce(
        (sum, d) => sum + d.totalDurationSeconds,
        0,
      );
      mediaOverlaysReport = {
        hasMediaOverlays: smilDocuments.length > 0,
        totalDurationSeconds: Math.round(totalDuration * 1000) / 1000,
        documentCount: smilDocuments.length,
        documents: smilDocuments,
        missingAudioFiles: Array.from(missingAudioFiles).sort(),
      };
    }

    // Check for orphan files in the archive
    // Excluded from orphan classification: mimetype, META-INF/*, the OPF file itself, or files with trailing '/' (directories)
    for (const entryPath of entryMap.keys()) {
      if (entryPath.endsWith("/")) continue;
      if (entryPath === "mimetype") continue;
      if (entryPath.startsWith("META-INF/")) continue;
      if (entryPath === opfPath) continue;

      if (
        !manifestHrefsInArchive.has(entryPath) &&
        !referencedAssets.has(entryPath)
      ) {
        findings.push({
          ruleId: "EPUB-RESOURCE-001",
          severity: "info",
          category: "resource",
          message: `Archive entry '${entryPath}' is not declared in the manifest and not referenced by any document.`,
          location: { path: entryPath },
          repairability: "review-required",
        });
      }
    }

    return finish(mediaOverlaysReport);
  } catch (err) {
    // Defense in depth: a malformed publication must yield a report, never an
    // exception that propagates into the caller (e.g. the desktop main process).
    findings.push({
      ruleId: "EPUB-CONTAINER-006",
      severity: "fatal",
      category: "container",
      message: `Inspection aborted because the archive could not be processed: ${describeError(err)}`,
      repairability: "none",
    });
    return finish();
  } finally {
    archive.close();
  }
}

/**
 * Maps a failure from openZipArchive (archive structure, entry names, entry
 * count) to a fatal finding instead of letting it escape as an exception.
 */
function classifyArchiveOpenFailure(
  err: unknown,
  limits: EpubLoaderLimits,
): QualityFinding {
  const message = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause : undefined;

  // yauzl rejects '..' segments, absolute paths and (with strictFileNames)
  // backslashes; the shared validator rejects the remaining unsafe forms.
  const yauzlUnsafeName =
    /^(?:absolute path|invalid relative path|invalid characters in fileName): /.exec(
      cause?.message ?? "",
    );
  if (yauzlUnsafeName || message.includes("unsafe entry path")) {
    const entryName = yauzlUnsafeName
      ? truncateText((cause?.message ?? "").slice(yauzlUnsafeName[0].length))
      : undefined;
    return {
      ruleId: "EPUB-SEC-001",
      severity: "fatal",
      category: "security",
      message: entryName
        ? `Archive entry contains an unsafe path: ${entryName}`
        : "Archive entry contains an unsafe path (empty, '.' or '..' segment, absolute or drive-letter path, backslash, or NUL character).",
      location: entryName ? { path: entryName } : undefined,
      repairability: "manual",
    };
  }

  if (message.includes("too many entries")) {
    return {
      ruleId: "EPUB-SEC-003",
      severity: "fatal",
      category: "security",
      message: `Archive declares more than ${limits.maxEntries} entries, exceeding the inspection limit; it was not inspected.`,
      evidence: [{ key: "limitEntries", value: limits.maxEntries }],
      repairability: "none",
    };
  }

  if (message.includes("exceeds the configured size limit")) {
    return {
      ruleId: "EPUB-SEC-003",
      severity: "fatal",
      category: "security",
      message: `Publication archive exceeds the ${limits.maxArchiveBytes}-byte inspection limit or is not a regular file; it was not opened.`,
      evidence: [{ key: "limitBytes", value: limits.maxArchiveBytes }],
      repairability: "none",
    };
  }

  if (message.includes("not a readable ZIP archive")) {
    return {
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: `Failed to open file as ZIP archive: ${describeError(cause ?? err)}`,
      repairability: "none",
    };
  }

  const duplicate = /duplicate entry: /.exec(message);
  const duplicateName = duplicate
    ? truncateText(message.slice(duplicate.index + duplicate[0].length))
    : undefined;
  return {
    ruleId: "EPUB-CONTAINER-006",
    severity: "fatal",
    category: "container",
    message: `The ZIP archive could not be read safely: ${describeError(err)}`,
    location: duplicateName ? { path: duplicateName } : undefined,
    repairability: "none",
  };
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return truncateText(String(err));
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : "";
  return truncateText(`${err.message}${cause}`);
}

function truncateText(text: string): string {
  return text.length > MAX_QUOTED_TEXT_CHARS
    ? `${text.slice(0, MAX_QUOTED_TEXT_CHARS)}…`
    : text;
}

function parseXml(text: string): {
  doc: Document | null;
  error?: string | undefined;
} {
  let errorMsg: string | undefined;
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === "error" || level === "fatalError") {
        errorMsg = message;
      }
    },
  });

  try {
    const doc = parser.parseFromString(text, "application/xml");
    return { doc, error: errorMsg };
  } catch (err) {
    return {
      doc: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getFileExtension(filePath: string): string {
  const idx = filePath.lastIndexOf(".");
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : "";
}

function finalizeReport(
  sourcePath: string,
  findings: QualityFinding[],
  startTime: number,
  rulesExecuted: Set<string>,
  rulesSkipped: string[],
  toolVersion?: string,
  mediaOverlays?: PublicationMediaOverlaysReport | undefined,
): HealthReport {
  const deduped = deduplicateFindings(findings);
  const summary = computeReportSummary(deduped);
  return {
    publicationPath: sourcePath,
    publicationType: "epub",
    inspectedAt: new Date().toISOString(),
    durationMs: Math.max(1, Date.now() - startTime),
    findings: deduped,
    summary,
    rulesExecuted: Array.from(rulesExecuted).sort(),
    rulesSkipped: [...rulesSkipped].sort(),
    toolVersion: toolVersion ?? REFLOWPRESS_VERSION,
    ...(mediaOverlays ? { mediaOverlays } : {}),
  };
}
