import { stat } from "node:fs/promises";
import { DOMParser, type Document } from "@xmldom/xmldom";
import * as yauzl from "yauzl";
import {
  computeReportSummary,
  deduplicateFindings,
  type HealthReport,
  type QualityFinding,
} from "../models.js";
import {
  extractReferencesFromCss,
  extractReferencesFromXml,
  resolveInternalPath,
} from "./resource-graph.js";

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
};

interface ZipEntryInfo {
  readonly entry: yauzl.Entry;
  readonly index: number;
}

export async function inspectEpubHealth(
  sourcePath: string,
  options?: { readonly toolVersion?: string | undefined } | undefined,
): Promise<HealthReport> {
  const startTime = Date.now();
  const findings: QualityFinding[] = [];
  const rulesExecuted = new Set<string>();
  const rulesSkipped: string[] = [];

  let fileStat;
  try {
    fileStat = await stat(sourcePath);
  } catch (err) {
    findings.push({
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: `Cannot access publication file: ${err instanceof Error ? err.message : String(err)}`,
      repairability: "none",
    });
    return finalizeReport(
      sourcePath,
      findings,
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
    );
  }

  if (!fileStat.isFile() || fileStat.size === 0) {
    findings.push({
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: "Publication file is empty or not a regular file.",
      repairability: "none",
    });
    return finalizeReport(
      sourcePath,
      findings,
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
    );
  }

  let archive: yauzl.ZipFile;
  try {
    archive = await yauzl.openPromise(sourcePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: false,
      validateEntrySizes: false,
    });
  } catch (err) {
    findings.push({
      ruleId: "EPUB-CONTAINER-001",
      severity: "fatal",
      category: "container",
      message: `Failed to open file as ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
      repairability: "none",
    });
    return finalizeReport(
      sourcePath,
      findings,
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
    );
  }

  try {
    const entryMap = new Map<string, ZipEntryInfo>();
    let entryIndex = 0;
    let firstEntryName: string | undefined;

    for await (const entry of archive.eachEntry()) {
      if (entryIndex === 0) {
        firstEntryName = entry.fileName;
      }

      // Security check: validate entry paths for traversal or absolute root
      rulesExecuted.add("EPUB-SEC-001");
      if (
        entry.fileName.includes("\\") ||
        entry.fileName.includes("\0") ||
        entry.fileName.startsWith("/") ||
        /^[A-Za-z]:/.test(entry.fileName) ||
        entry.fileName
          .split("/")
          .some((seg: string) => seg === ".." || seg === ".")
      ) {
        findings.push({
          ruleId: "EPUB-SEC-001",
          severity: "fatal",
          category: "security",
          message: `Archive entry contains an unsafe path: ${entry.fileName}`,
          location: { path: entry.fileName },
          repairability: "manual",
        });
      }

      entryMap.set(entry.fileName, { entry, index: entryIndex });
      entryIndex += 1;
    }

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
      const mimetypeBuffer = await readEntry(archive, mimetypeEntryInfo.entry);
      const mimetypeText = mimetypeBuffer.toString("utf-8");

      if (mimetypeText !== "application/epub+zip") {
        findings.push({
          ruleId: "EPUB-CONTAINER-002",
          severity: "error",
          category: "container",
          message: `Invalid mimetype content: expected 'application/epub+zip', found '${mimetypeText}'.`,
          location: { path: "mimetype" },
          evidence: [{ key: "actualMimetype", value: mimetypeText }],
          repairability: "safe-auto",
        });
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
      const containerText = (
        await readEntry(archive, containerEntryInfo.entry)
      ).toString("utf-8");
      const { doc, error } = parseXml(containerText);
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

    if (!opfPath || !entryMap.has(opfPath)) {
      findings.push({
        ruleId: "EPUB-PACKAGE-001",
        severity: "fatal",
        category: "package",
        message: `OPF package document '${opfPath ?? "unknown"}' not found in archive.`,
        location: { path: opfPath ?? "META-INF/container.xml" },
        repairability: "manual",
      });
      return finalizeReport(
        sourcePath,
        findings,
        startTime,
        rulesExecuted,
        rulesSkipped,
        options?.toolVersion,
      );
    }

    const opfEntryInfo = entryMap.get(opfPath)!;
    const opfContent = (await readEntry(archive, opfEntryInfo.entry)).toString(
      "utf-8",
    );
    const { doc: opfDoc, error: opfXmlError } = parseXml(opfContent);

    if (opfXmlError || !opfDoc) {
      findings.push({
        ruleId: "EPUB-PACKAGE-002",
        severity: "fatal",
        category: "package",
        message: `Invalid OPF XML syntax in '${opfPath}': ${opfXmlError ?? "XML parse error"}`,
        location: { path: opfPath },
        repairability: "manual",
      });
      return finalizeReport(
        sourcePath,
        findings,
        startTime,
        rulesExecuted,
        rulesSkipped,
        options?.toolVersion,
      );
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
      { href: string; mediaType: string; fullPath: string }
    >();
    const manifestHrefsInArchive = new Set<string>();

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
        manifestItemsById.set(id, { href, mediaType, fullPath });
        manifestHrefsInArchive.add(fullPath);

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
    } else if (navDocPath && entryMap.has(navDocPath)) {
      const navText = (
        await readEntry(archive, entryMap.get(navDocPath)!.entry)
      ).toString("utf-8");
      const { doc: navDoc, error: navError } = parseXml(navText);
      if (navError || !navDoc) {
        findings.push({
          ruleId: "EPUB-NAV-003",
          severity: "error",
          category: "navigation",
          message: `Navigation document '${navDocPath}' has invalid XML syntax: ${navError ?? "parse error"}`,
          location: { path: navDocPath },
          repairability: "manual",
        });
      } else {
        // Inspect links inside nav document
        const links = navDoc.getElementsByTagName("a");
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

    const referencedAssets = new Set<string>();
    // Collect references from all XHTML/CSS documents
    for (const [entryPath, info] of entryMap.entries()) {
      if (entryPath.endsWith(".xhtml") || entryPath.endsWith(".html")) {
        const text = (await readEntry(archive, info.entry)).toString("utf-8");

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

        const refs = extractReferencesFromXml(text);
        for (const ref of refs) {
          const target = resolveInternalPath(entryPath, ref);
          if (target) {
            referencedAssets.add(target);
            if (!entryMap.has(target)) {
              findings.push({
                ruleId: "EPUB-RESOURCE-002",
                severity: "warning",
                category: "resource",
                message: `Broken internal resource reference '${ref}' -> '${target}'.`,
                location: { path: entryPath },
                evidence: [
                  { key: "ref", value: ref },
                  { key: "resolved", value: target },
                ],
                repairability: "manual",
              });
            }
          }
        }
      } else if (entryPath.endsWith(".css")) {
        const text = (await readEntry(archive, info.entry)).toString("utf-8");
        const refs = extractReferencesFromCss(text);
        for (const ref of refs) {
          const target = resolveInternalPath(entryPath, ref);
          if (target) {
            referencedAssets.add(target);
            if (!entryMap.has(target)) {
              findings.push({
                ruleId: "EPUB-RESOURCE-002",
                severity: "warning",
                category: "resource",
                message: `Broken CSS url reference '${ref}' -> '${target}'.`,
                location: { path: entryPath },
                evidence: [
                  { key: "ref", value: ref },
                  { key: "resolved", value: target },
                ],
                repairability: "manual",
              });
            }
          }
        }
      }
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

    return finalizeReport(
      sourcePath,
      findings,
      startTime,
      rulesExecuted,
      rulesSkipped,
      options?.toolVersion,
    );
  } finally {
    archive.close();
  }
}

async function readEntry(
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
    toolVersion: toolVersion ?? "0.1.0",
  };
}
