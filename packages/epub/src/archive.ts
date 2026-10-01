import { stat } from "node:fs/promises";
import * as yauzl from "yauzl";

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  CRC32_TABLE[index] = value >>> 0;
}

export function validateArchiveEntryName<E extends Error>(
  name: string,
  createError: (message: string) => E,
): void {
  if (
    name.length === 0 ||
    name.length > 4096 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw createError("The EPUB archive contains an unsafe entry path.");
  }

  const segments = name.split("/");
  const pathSegments = name.endsWith("/") ? segments.slice(0, -1) : segments;
  if (
    pathSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw createError("The EPUB archive contains an unsafe entry path.");
  }
}

export interface OpenedZipArchive {
  readonly archive: yauzl.ZipFile;
  readonly entries: ReadonlyMap<string, yauzl.Entry>;
}

export async function openZipArchive<E extends Error>(
  sourcePath: string,
  limits: { maxArchiveBytes: number; maxEntries: number },
  createArchiveError: (message: string, cause?: unknown) => E,
): Promise<OpenedZipArchive> {
  const source = await stat(sourcePath);
  if (!source.isFile() || source.size > limits.maxArchiveBytes) {
    throw createArchiveError(
      "The EPUB archive is not a regular file or exceeds the configured size limit.",
    );
  }

  let archive: yauzl.ZipFile;
  try {
    archive = await yauzl.openPromise(sourcePath, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (cause) {
    throw createArchiveError("The input is not a readable ZIP archive.", cause);
  }

  try {
    if (archive.entryCount > limits.maxEntries) {
      throw createArchiveError("The EPUB archive contains too many entries.");
    }

    const entries = new Map<string, yauzl.Entry>();
    try {
      for await (const entry of archive.eachEntry()) {
        validateArchiveEntryName(entry.fileName, createArchiveError);
        if (entries.has(entry.fileName)) {
          throw createArchiveError(
            `The EPUB archive contains a duplicate entry: ${entry.fileName}`,
          );
        }
        entries.set(entry.fileName, entry);
      }
    } catch (cause) {
      if (cause instanceof Error && "code" in cause) throw cause;
      throw createArchiveError(
        "The EPUB archive contains unreadable or unsafe entries.",
        cause,
      );
    }

    return { archive, entries };
  } catch (error) {
    archive.close();
    throw error;
  }
}

export async function readEntryBuffer<E extends Error>(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxBytes: number,
  createError: (message: string, cause?: unknown) => E,
): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) {
    throw createError("The archive entry exceeds the configured size limit.");
  }
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw createError("The archive entry is encrypted or cannot be decoded.");
  }

  try {
    const stream = await archive.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    let size = 0;
    let checksum = 0xffffffff;

    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        stream.destroy();
        throw createError(
          "The archive entry exceeds the configured size limit.",
        );
      }
      for (const byte of bytes) {
        const tableIndex = (checksum ^ byte) & 0xff;
        checksum = (CRC32_TABLE[tableIndex] ?? 0) ^ (checksum >>> 8);
      }
      chunks.push(bytes);
    }

    if (size !== entry.uncompressedSize) {
      throw createError("The archive entry has an inconsistent size.");
    }
    if ((checksum ^ 0xffffffff) >>> 0 !== entry.crc32) {
      throw createError("The archive entry does not match its ZIP CRC.");
    }

    return Buffer.concat(chunks);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) throw cause;
    throw createError("The archive entry could not be read.", cause);
  }
}

export async function readEntryText<E extends Error>(
  archive: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxBytes: number,
  createError: (message: string, cause?: unknown) => E,
): Promise<string> {
  const buffer = await readEntryBuffer(archive, entry, maxBytes, createError);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (cause) {
    throw createError("The archive entry is not readable UTF-8 text.", cause);
  }
}
