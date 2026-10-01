import path from "node:path";
import type { Element, Document } from "@xmldom/xmldom";
import type * as yauzl from "yauzl";
import { resolveArchiveReference } from "./path.js";
import { directChildren, firstDirectChild } from "./xml.js";

const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
const OPF_MEDIA_TYPE = "application/oebps-package+xml";

export interface ParsedManifestItem {
  readonly id: string;
  readonly href: string;
  readonly resolvedPath: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

export interface ParsedSpineItem {
  readonly idref: string;
  readonly linear: boolean;
}

export interface ParsedPackageMetadata {
  readonly title?: string;
  readonly language?: string;
  readonly identifier?: string;
  readonly creator: readonly string[];
  readonly publisher?: string;
  readonly description?: string;
  readonly rights?: string;
  readonly modified?: string;
  readonly renditionLayout?: "reflowable" | "pre-paginated";
  readonly renditionOrientation?: "auto" | "portrait" | "landscape";
  readonly renditionSpread?: "auto" | "none" | "landscape" | "both";
  readonly direction?: "ltr" | "rtl" | "default";
}

export interface ParsedPackageDocument {
  readonly version: string;
  readonly packagePath: string;
  readonly metadata: ParsedPackageMetadata;
  readonly manifest: readonly ParsedManifestItem[];
  readonly manifestMap: ReadonlyMap<string, ParsedManifestItem>;
  readonly manifestByResolvedPath: ReadonlyMap<string, ParsedManifestItem>;
  readonly spine: readonly ParsedSpineItem[];
  readonly navItem?: ParsedManifestItem | undefined;
  readonly ncxItem?: ParsedManifestItem | undefined;
}

export function readContainerPackagePath<E extends Error>(
  containerDoc: Document,
  createError: (message: string, cause?: unknown) => E,
): string {
  const root = containerDoc.documentElement;
  if (root === null || root.localName !== "container") {
    throw createError("The container XML root must be container.");
  }

  const rootfiles = firstDirectChild(root, "rootfiles");
  const rootfile =
    rootfiles === undefined
      ? undefined
      : directChildren(rootfiles, "rootfile")[0];
  const fullPath = rootfile?.getAttribute("full-path");
  if (
    fullPath === null ||
    fullPath === undefined ||
    fullPath.trim().length === 0
  ) {
    throw createError(
      "The container XML must reference a package document with full-path.",
    );
  }
  if (rootfile?.getAttribute("media-type") !== OPF_MEDIA_TYPE) {
    throw createError(
      `The container XML rootfile media-type must be ${OPF_MEDIA_TYPE}.`,
    );
  }

  try {
    return resolveArchiveReference("", fullPath);
  } catch (cause) {
    throw createError(
      "The container XML package path is invalid or escapes the archive.",
      cause,
    );
  }
}

export function parsePackageDocument<
  EPackage extends Error,
  EManifestMissing extends Error,
>(
  document: Document,
  packagePath: string,
  entries: ReadonlyMap<string, yauzl.Entry>,
  createPackageError: (message: string, cause?: unknown) => EPackage,
  createManifestMissingError: (message: string) => EManifestMissing,
): ParsedPackageDocument {
  const root = document.documentElement;
  if (root === null || root.localName !== "package") {
    throw createPackageError("The package document root must be package.");
  }

  const version = root.getAttribute("version")?.trim() || "3.0";

  const metadataElement = firstDirectChild(root, "metadata");
  const manifestElement = firstDirectChild(root, "manifest");
  const spineElement = firstDirectChild(root, "spine");
  if (
    metadataElement === undefined ||
    manifestElement === undefined ||
    spineElement === undefined
  ) {
    throw createPackageError(
      "The package document must contain metadata, manifest, and spine elements.",
    );
  }

  const manifest: ParsedManifestItem[] = [];
  const manifestMap = new Map<string, ParsedManifestItem>();
  const manifestByResolvedPath = new Map<string, ParsedManifestItem>();
  const packageDir = path.posix.dirname(packagePath);

  for (const item of directChildren(manifestElement, "item")) {
    const id = item.getAttribute("id")?.trim();
    if (!id) throw createPackageError("Manifest items require an id.");

    const href = item.getAttribute("href")?.trim();
    if (!href)
      throw createPackageError(`Manifest item ${id} requires an href.`);

    const mediaType = item.getAttribute("media-type")?.trim();
    if (!mediaType) {
      throw createPackageError(`Manifest item ${id} requires a media-type.`);
    }

    if (manifestMap.has(id)) {
      throw createPackageError(`The manifest contains duplicate id ${id}.`);
    }

    let resolvedPath: string;
    try {
      resolvedPath = resolveArchiveReference(packageDir, href);
    } catch (cause) {
      throw createPackageError(
        `Manifest item ${id} has an invalid href or escapes the archive.`,
        cause,
      );
    }

    if (!entries.has(resolvedPath)) {
      throw createManifestMissingError(
        `Manifest item ${id} references missing archive entry ${resolvedPath}.`,
      );
    }

    const properties = (item.getAttribute("properties") ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const parsedItem: ParsedManifestItem = {
      id,
      href,
      resolvedPath,
      mediaType,
      properties,
    };
    manifest.push(parsedItem);
    manifestMap.set(id, parsedItem);
    manifestByResolvedPath.set(resolvedPath, parsedItem);
  }

  if (manifest.length === 0) {
    throw createPackageError(
      "The package manifest must contain at least one item.",
    );
  }

  const spineItems = directChildren(spineElement, "itemref");
  const spine: ParsedSpineItem[] = spineItems.map((itemref) => {
    const idref = itemref.getAttribute("idref")?.trim();
    if (!idref) {
      throw createPackageError("Spine itemrefs require an idref.");
    }
    if (!manifestMap.has(idref)) {
      throw createPackageError(
        `Spine itemref ${idref} does not match a manifest item.`,
      );
    }
    const linear = itemref.getAttribute("linear");
    if (linear !== null && linear !== "yes" && linear !== "no") {
      throw createPackageError(
        `Spine itemref ${idref} has an invalid linear value.`,
      );
    }
    return { idref, linear: linear !== "no" };
  });

  if (spine.length === 0) {
    throw createPackageError(
      "The package spine must contain at least one itemref.",
    );
  }

  // Navigation document determination
  // EPUB 3: item with properties containing "nav"
  const navItem = manifest.find((item) => item.properties.includes("nav"));

  // EPUB 2: spine toc attribute or manifest item with media-type application/x-dtbncx+xml
  const spineTocId = spineElement.getAttribute("toc")?.trim();
  const ncxItem = spineTocId
    ? manifestMap.get(spineTocId)
    : manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");

  const metadata = parseMetadata(metadataElement, spineElement);

  return {
    version,
    packagePath,
    metadata,
    manifest,
    manifestMap,
    manifestByResolvedPath,
    spine,
    navItem,
    ncxItem,
  };
}

function parseMetadata(
  metadata: Element,
  spineElement: Element,
): ParsedPackageMetadata {
  const dcValue = (localName: string) =>
    directChildren(metadata, localName)
      .find((element) => element.namespaceURI === DC_NAMESPACE)
      ?.textContent?.trim();

  const title = dcValue("title");
  const language = dcValue("language");
  const identifier = dcValue("identifier");
  const publisher = dcValue("publisher");
  const description = dcValue("description");
  const rights = dcValue("rights");

  const creator = directChildren(metadata, "creator")
    .filter((element) => element.namespaceURI === DC_NAMESPACE)
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);

  // Meta properties (EPUB 3 / prefix-aware metadata or EPUB 2 meta name/content)
  const metaElements = directChildren(metadata, "meta");
  let modified: string | undefined;
  let renditionLayout: "reflowable" | "pre-paginated" | undefined;
  let renditionOrientation: "auto" | "portrait" | "landscape" | undefined;
  let renditionSpread: "auto" | "none" | "landscape" | "both" | undefined;

  for (const meta of metaElements) {
    const property = meta.getAttribute("property")?.trim();
    const name = meta.getAttribute("name")?.trim();
    const content =
      meta.textContent?.trim() || meta.getAttribute("content")?.trim();

    if (property === "dcterms:modified" && content) {
      modified = content;
    }
    if (
      (property === "rendition:layout" || name === "rendition:layout") &&
      content
    ) {
      if (content === "reflowable" || content === "pre-paginated") {
        renditionLayout = content;
      }
    }
    if (
      (property === "rendition:orientation" ||
        name === "rendition:orientation") &&
      content
    ) {
      if (
        content === "auto" ||
        content === "portrait" ||
        content === "landscape"
      ) {
        renditionOrientation = content;
      }
    }
    if (
      (property === "rendition:spread" || name === "rendition:spread") &&
      content
    ) {
      if (
        content === "auto" ||
        content === "none" ||
        content === "landscape" ||
        content === "both"
      ) {
        renditionSpread = content;
      }
    }
  }

  // Reading direction from spine attribute
  const pageProgressionDirection = spineElement
    .getAttribute("page-progression-direction")
    ?.trim();
  let direction: "ltr" | "rtl" | "default" | undefined;
  if (
    pageProgressionDirection === "ltr" ||
    pageProgressionDirection === "rtl" ||
    pageProgressionDirection === "default"
  ) {
    direction = pageProgressionDirection;
  }

  return {
    ...(title ? { title } : {}),
    ...(language ? { language } : {}),
    ...(identifier ? { identifier } : {}),
    ...(publisher ? { publisher } : {}),
    ...(description ? { description } : {}),
    ...(rights ? { rights } : {}),
    ...(modified ? { modified } : {}),
    ...(renditionLayout ? { renditionLayout } : {}),
    ...(renditionOrientation ? { renditionOrientation } : {}),
    ...(renditionSpread ? { renditionSpread } : {}),
    ...(direction ? { direction } : {}),
    creator,
  };
}
