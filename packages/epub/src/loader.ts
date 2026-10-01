import type {
  NavigationItem,
  NormalizedPublication,
  PublicationResource,
  PublicationSection,
  PublicationSource,
} from "@reflowpress/core";
import { openZipArchive, readEntryBuffer, readEntryText } from "./archive.js";
import {
  parsePackageDocument,
  readContainerPackagePath,
} from "./package-document.js";
import { parseNavDocument, parseNcxDocument } from "./navigation.js";
import { parseXml } from "./xml.js";

const CONTAINER_PATH = "META-INF/container.xml";
const ENCRYPTION_PATH = "META-INF/encryption.xml";
const RIGHTS_PATH = "META-INF/rights.xml";

export type EpubLoadingErrorCode =
  | "INVALID_EPUB_ARCHIVE"
  | "CONTAINER_XML_NOT_FOUND"
  | "INVALID_CONTAINER_XML"
  | "PACKAGE_DOCUMENT_NOT_FOUND"
  | "INVALID_PACKAGE_DOCUMENT"
  | "MANIFEST_REFERENCE_NOT_FOUND"
  | "CONTENT_DOCUMENT_NOT_FOUND"
  | "INVALID_CONTENT_DOCUMENT"
  | "NAVIGATION_DOCUMENT_NOT_FOUND"
  | "INVALID_NAVIGATION_DOCUMENT"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "UNSUPPORTED_EPUB_FEATURE"
  | "DRM_PROTECTED_PUBLICATION";

export class EpubLoadingError extends Error {
  constructor(
    readonly code: EpubLoadingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EpubLoadingError";
  }
}

export interface EpubLoaderLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxMetadataDocumentBytes: number;
  readonly maxResourceBytes: number;
  readonly maxMarkupBytes: number;
  readonly maxTotalLoadedBytes: number;
}

export const DEFAULT_LOADER_LIMITS: EpubLoaderLimits = {
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 20_000,
  maxMetadataDocumentBytes: 4 * 1024 * 1024,
  maxResourceBytes: 16 * 1024 * 1024,
  maxMarkupBytes: 8 * 1024 * 1024,
  maxTotalLoadedBytes: 128 * 1024 * 1024,
};

export interface EpubSource extends PublicationSource {
  readonly mediaType: "application/epub+zip";
}

/**
 * Loads an EPUB publication archive into a normalized publication model.
 */
export async function loadEpub(
  source: string | EpubSource,
  overrides: Partial<EpubLoaderLimits> = {},
): Promise<NormalizedPublication> {
  const sourcePath = typeof source === "string" ? source : source.path;
  const limits: EpubLoaderLimits = { ...DEFAULT_LOADER_LIMITS, ...overrides };
  validateLoaderLimits(limits);

  const { archive, entries } = await openZipArchive(
    sourcePath,
    limits,
    (msg, cause) =>
      new EpubLoadingError("INVALID_EPUB_ARCHIVE", msg, { cause }),
  );

  let totalLoadedBytes = 0;

  try {
    // 1. DRM / Encryption check
    if (entries.has(ENCRYPTION_PATH) || entries.has(RIGHTS_PATH)) {
      throw new EpubLoadingError(
        "DRM_PROTECTED_PUBLICATION",
        "The EPUB archive contains DRM-protected or encrypted resources.",
      );
    }

    // 2. Read and parse container.xml
    const containerEntry = entries.get(CONTAINER_PATH);
    if (!containerEntry) {
      throw new EpubLoadingError(
        "CONTAINER_XML_NOT_FOUND",
        `The EPUB archive does not contain ${CONTAINER_PATH}.`,
      );
    }

    const containerText = await readEntryText(
      archive,
      containerEntry,
      limits.maxMetadataDocumentBytes,
      (msg, cause) =>
        new EpubLoadingError("INVALID_CONTAINER_XML", msg, { cause }),
    );
    const containerDoc = parseXml(
      containerText,
      (msg, cause) =>
        new EpubLoadingError("INVALID_CONTAINER_XML", msg, { cause }),
    );

    const packagePath = readContainerPackagePath(
      containerDoc,
      (msg, cause) =>
        new EpubLoadingError("INVALID_CONTAINER_XML", msg, { cause }),
    );

    // 3. Read and parse OPF package document
    const packageEntry = entries.get(packagePath);
    if (!packageEntry) {
      throw new EpubLoadingError(
        "PACKAGE_DOCUMENT_NOT_FOUND",
        `The package document ${packagePath} referenced by container.xml is missing.`,
      );
    }

    const packageText = await readEntryText(
      archive,
      packageEntry,
      limits.maxMetadataDocumentBytes,
      (msg, cause) =>
        new EpubLoadingError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
    );
    const packageDoc = parseXml(
      packageText,
      (msg, cause) =>
        new EpubLoadingError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
    );

    const parsedPackage = parsePackageDocument(
      packageDoc,
      packagePath,
      entries,
      (msg, cause) =>
        new EpubLoadingError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
      (msg) => new EpubLoadingError("MANIFEST_REFERENCE_NOT_FOUND", msg),
    );

    // 4. Load Reading Order (Spine -> Manifest -> Content documents)
    const spineResolvedPaths = new Set<string>();
    const readingOrder: PublicationSection[] = [];

    for (const spineItem of parsedPackage.spine) {
      const manifestItem = parsedPackage.manifestMap.get(spineItem.idref);
      if (!manifestItem) {
        throw new EpubLoadingError(
          "INVALID_PACKAGE_DOCUMENT",
          `Spine itemref ${spineItem.idref} does not exist in manifest.`,
        );
      }

      const contentEntry = entries.get(manifestItem.resolvedPath);
      if (!contentEntry) {
        throw new EpubLoadingError(
          "CONTENT_DOCUMENT_NOT_FOUND",
          `Content document ${manifestItem.resolvedPath} is missing from archive.`,
        );
      }

      if (contentEntry.uncompressedSize > limits.maxMarkupBytes) {
        throw new EpubLoadingError(
          "RESOURCE_LIMIT_EXCEEDED",
          `Content document ${manifestItem.resolvedPath} exceeds maxMarkupBytes limit.`,
        );
      }

      totalLoadedBytes += contentEntry.uncompressedSize;
      if (totalLoadedBytes > limits.maxTotalLoadedBytes) {
        throw new EpubLoadingError(
          "RESOURCE_LIMIT_EXCEEDED",
          "Total loaded bytes exceeded maxTotalLoadedBytes limit.",
        );
      }

      const markup = await readEntryText(
        archive,
        contentEntry,
        limits.maxMarkupBytes,
        (msg, cause) =>
          new EpubLoadingError("INVALID_CONTENT_DOCUMENT", msg, { cause }),
      );

      // Validate well-formedness of XHTML content document (DTD rejected)
      parseXml(
        markup,
        (msg, cause) =>
          new EpubLoadingError(
            "INVALID_CONTENT_DOCUMENT",
            `Content document ${manifestItem.resolvedPath} is malformed XML: ${msg}`,
            { cause },
          ),
      );

      readingOrder.push({
        id: manifestItem.id,
        href: manifestItem.href,
        mediaType: manifestItem.mediaType,
        markup,
        linear: spineItem.linear,
      });

      spineResolvedPaths.add(manifestItem.resolvedPath);
    }

    // 5. Load Navigation Document (EPUB 3 nav or EPUB 2 NCX)
    let navigation: readonly NavigationItem[] | undefined;
    if (parsedPackage.navItem) {
      const navEntry = entries.get(parsedPackage.navItem.resolvedPath);
      if (!navEntry) {
        throw new EpubLoadingError(
          "NAVIGATION_DOCUMENT_NOT_FOUND",
          `Navigation document ${parsedPackage.navItem.resolvedPath} is missing.`,
        );
      }

      const navText = await readEntryText(
        archive,
        navEntry,
        limits.maxMetadataDocumentBytes,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );

      const navDoc = parseXml(
        navText,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );

      navigation = parseNavDocument(
        navDoc,
        parsedPackage.navItem.resolvedPath,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );
    } else if (parsedPackage.ncxItem) {
      const ncxEntry = entries.get(parsedPackage.ncxItem.resolvedPath);
      if (!ncxEntry) {
        throw new EpubLoadingError(
          "NAVIGATION_DOCUMENT_NOT_FOUND",
          `NCX document ${parsedPackage.ncxItem.resolvedPath} is missing.`,
        );
      }

      const ncxText = await readEntryText(
        archive,
        ncxEntry,
        limits.maxMetadataDocumentBytes,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );

      const ncxDoc = parseXml(
        ncxText,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );

      navigation = parseNcxDocument(
        ncxDoc,
        parsedPackage.ncxItem.resolvedPath,
        (msg, cause) =>
          new EpubLoadingError("INVALID_NAVIGATION_DOCUMENT", msg, { cause }),
      );
    }

    // 6. Load Auxiliary Publication Resources (CSS, images, fonts, etc.)
    const resources: PublicationResource[] = [];
    for (const item of parsedPackage.manifest) {
      // Skip spine content documents and package/navigation files from auxiliary resources
      if (
        spineResolvedPaths.has(item.resolvedPath) ||
        item.resolvedPath === packagePath ||
        (parsedPackage.navItem &&
          item.resolvedPath === parsedPackage.navItem.resolvedPath) ||
        (parsedPackage.ncxItem &&
          item.resolvedPath === parsedPackage.ncxItem.resolvedPath)
      ) {
        continue;
      }

      const resourceEntry = entries.get(item.resolvedPath);
      if (!resourceEntry) {
        throw new EpubLoadingError(
          "RESOURCE_NOT_FOUND",
          `Manifest resource ${item.resolvedPath} is missing.`,
        );
      }

      if (resourceEntry.uncompressedSize > limits.maxResourceBytes) {
        throw new EpubLoadingError(
          "RESOURCE_LIMIT_EXCEEDED",
          `Resource ${item.resolvedPath} exceeds maxResourceBytes limit.`,
        );
      }

      totalLoadedBytes += resourceEntry.uncompressedSize;
      if (totalLoadedBytes > limits.maxTotalLoadedBytes) {
        throw new EpubLoadingError(
          "RESOURCE_LIMIT_EXCEEDED",
          "Total loaded bytes exceeded maxTotalLoadedBytes limit.",
        );
      }

      const bytes = await readEntryBuffer(
        archive,
        resourceEntry,
        limits.maxResourceBytes,
        (msg, cause) =>
          new EpubLoadingError("RESOURCE_NOT_FOUND", msg, { cause }),
      );

      resources.push({
        href: item.href,
        mediaType: item.mediaType,
        bytes: new Uint8Array(bytes),
      });
    }

    return {
      version: parsedPackage.version,
      metadata: {
        ...(parsedPackage.metadata.title
          ? { title: parsedPackage.metadata.title }
          : {}),
        ...(parsedPackage.metadata.language
          ? { language: parsedPackage.metadata.language }
          : {}),
        ...(parsedPackage.metadata.identifier
          ? { identifier: parsedPackage.metadata.identifier }
          : {}),
        ...(parsedPackage.metadata.creator.length > 0
          ? { creator: parsedPackage.metadata.creator }
          : {}),
        ...(parsedPackage.metadata.publisher
          ? { publisher: parsedPackage.metadata.publisher }
          : {}),
        ...(parsedPackage.metadata.description
          ? { description: parsedPackage.metadata.description }
          : {}),
        ...(parsedPackage.metadata.rights
          ? { rights: parsedPackage.metadata.rights }
          : {}),
        ...(parsedPackage.metadata.modified
          ? { modified: parsedPackage.metadata.modified }
          : {}),
        ...(parsedPackage.metadata.renditionLayout
          ? { renditionLayout: parsedPackage.metadata.renditionLayout }
          : {}),
        ...(parsedPackage.metadata.renditionOrientation
          ? {
              renditionOrientation: parsedPackage.metadata.renditionOrientation,
            }
          : {}),
        ...(parsedPackage.metadata.renditionSpread
          ? { renditionSpread: parsedPackage.metadata.renditionSpread }
          : {}),
        ...(parsedPackage.metadata.direction
          ? { direction: parsedPackage.metadata.direction }
          : {}),
      },
      readingOrder,
      resources,
      ...(navigation !== undefined ? { navigation } : {}),
    };
  } finally {
    archive.close();
  }
}

/**
 * PublicationAdapter implementation for EPUB files.
 */
export class EpubLoader {
  readonly id = "epub" as const;

  canRead(source: PublicationSource): boolean {
    return (
      source.mediaType === "application/epub+zip" ||
      source.path.toLowerCase().endsWith(".epub")
    );
  }

  async read(source: PublicationSource): Promise<NormalizedPublication> {
    return loadEpub(source.path);
  }

  async load(
    sourcePath: string,
    overrides?: Partial<EpubLoaderLimits>,
  ): Promise<NormalizedPublication> {
    return loadEpub(sourcePath, overrides);
  }
}

function validateLoaderLimits(limits: EpubLoaderLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
}
