import { openZipArchive, readEntryText } from "./archive.js";
import {
  parsePackageDocument,
  readContainerPackagePath,
} from "./package-document.js";
import { parseXml } from "./xml.js";

const DEFAULT_LIMITS: EpubInspectionLimits = {
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 20_000,
  maxMetadataDocumentBytes: 4 * 1024 * 1024,
};
const CONTAINER_PATH = "META-INF/container.xml";

export type EpubInspectionErrorCode =
  | "INVALID_EPUB_ARCHIVE"
  | "CONTAINER_XML_NOT_FOUND"
  | "INVALID_CONTAINER_XML"
  | "PACKAGE_DOCUMENT_NOT_FOUND"
  | "INVALID_PACKAGE_DOCUMENT"
  | "MANIFEST_REFERENCE_NOT_FOUND";

export class EpubInspectionError extends Error {
  constructor(
    readonly code: EpubInspectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EpubInspectionError";
  }
}

export interface EpubInspectionLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxMetadataDocumentBytes: number;
}

export interface EpubMetadata {
  readonly title?: string;
  readonly language?: string;
  readonly identifier?: string;
  readonly creator: readonly string[];
}

export interface EpubManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

export interface EpubSpineItem {
  readonly idref: string;
  readonly linear: boolean;
}

export interface EpubInspection {
  readonly packagePath: string;
  readonly metadata: EpubMetadata;
  readonly manifest: readonly EpubManifestItem[];
  readonly spine: readonly EpubSpineItem[];
}

/** Inspect EPUB container/package structure without extracting publication files. */
export async function inspectEpub(
  sourcePath: string,
  overrides: Partial<EpubInspectionLimits> = {},
): Promise<EpubInspection> {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  validateLimits(limits);

  const { archive, entries } = await openZipArchive(
    sourcePath,
    limits,
    (msg, cause) =>
      new EpubInspectionError("INVALID_EPUB_ARCHIVE", msg, { cause }),
  );

  try {
    const containerEntry = entries.get(CONTAINER_PATH);
    if (containerEntry === undefined) {
      throw new EpubInspectionError(
        "CONTAINER_XML_NOT_FOUND",
        `The EPUB archive does not contain ${CONTAINER_PATH}.`,
      );
    }

    const containerText = await readEntryText(
      archive,
      containerEntry,
      limits.maxMetadataDocumentBytes,
      (msg, cause) =>
        new EpubInspectionError("INVALID_CONTAINER_XML", msg, { cause }),
    );
    const containerDoc = parseXml(
      containerText,
      (msg, cause) =>
        new EpubInspectionError("INVALID_CONTAINER_XML", msg, { cause }),
    );

    const packagePath = readContainerPackagePath(
      containerDoc,
      (msg, cause) =>
        new EpubInspectionError("INVALID_CONTAINER_XML", msg, { cause }),
    );

    const packageEntry = entries.get(packagePath);
    if (packageEntry === undefined) {
      throw new EpubInspectionError(
        "PACKAGE_DOCUMENT_NOT_FOUND",
        `The package document ${packagePath} referenced by container.xml is missing.`,
      );
    }

    const packageText = await readEntryText(
      archive,
      packageEntry,
      limits.maxMetadataDocumentBytes,
      (msg, cause) =>
        new EpubInspectionError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
    );
    const packageDoc = parseXml(
      packageText,
      (msg, cause) =>
        new EpubInspectionError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
    );

    const parsed = parsePackageDocument(
      packageDoc,
      packagePath,
      entries,
      (msg, cause) =>
        new EpubInspectionError("INVALID_PACKAGE_DOCUMENT", msg, { cause }),
      (msg) => new EpubInspectionError("MANIFEST_REFERENCE_NOT_FOUND", msg),
    );

    return {
      packagePath: parsed.packagePath,
      metadata: {
        ...(parsed.metadata.title ? { title: parsed.metadata.title } : {}),
        ...(parsed.metadata.language
          ? { language: parsed.metadata.language }
          : {}),
        ...(parsed.metadata.identifier
          ? { identifier: parsed.metadata.identifier }
          : {}),
        creator: parsed.metadata.creator,
      },
      manifest: parsed.manifest.map((item) => ({
        id: item.id,
        href: item.href,
        mediaType: item.mediaType,
        properties: item.properties,
      })),
      spine: parsed.spine.map((item) => ({
        idref: item.idref,
        linear: item.linear,
      })),
    };
  } finally {
    archive.close();
  }
}

function validateLimits(limits: EpubInspectionLimits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
}
