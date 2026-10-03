import { deflateRawSync } from "node:zlib";

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function computeCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipOutputEntry {
  readonly name: string;
  readonly contents: Buffer;
  readonly isStored?: boolean; // force method 0 (STORE)
}

/**
 * Builds an EPUB ZIP buffer guaranteeing canonical structure:
 * - 'mimetype' is entry 0, uncompressed STORE (method 0) at offset 38.
 * - Other entries are compressed with DEFLATE (method 8) unless isStored is set.
 */
export function buildCanonicalEpubZip(
  entries: readonly ZipOutputEntry[],
): Buffer {
  // Ensure 'mimetype' is first
  const mimetypeEntry = entries.find((e) => e.name === "mimetype");
  const otherEntries = entries.filter((e) => e.name !== "mimetype");

  const orderedEntries: ZipOutputEntry[] = [
    mimetypeEntry ?? {
      name: "mimetype",
      contents: Buffer.from("application/epub+zip", "utf-8"),
      isStored: true,
    },
    ...otherEntries,
  ];

  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let localOffset = 0;

  for (let i = 0; i < orderedEntries.length; i += 1) {
    const entry = orderedEntries[i]!;
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const rawData = entry.contents;
    const crc = computeCrc32(rawData);

    const isStore = i === 0 || entry.isStored === true;
    let compressedData = rawData;
    let compressionMethod = 0;

    if (!isStore) {
      try {
        const deflated = deflateRawSync(rawData);
        if (deflated.length < rawData.length) {
          compressedData = deflated;
          compressionMethod = 8;
        }
      } catch {
        // Fallback to store
        compressedData = rawData;
        compressionMethod = 0;
      }
    }

    // Local file header (30 bytes)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4); // Min version (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(compressionMethod, 8); // Compression method
    localHeader.writeUInt16LE(0, 10); // Last mod time
    localHeader.writeUInt16LE(0, 12); // Last mod date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(compressedData.length, 18); // Compressed size
    localHeader.writeUInt32LE(rawData.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length

    localFiles.push(localHeader, nameBytes, compressedData);

    // Central directory header (46 bytes)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8); // General purpose bit flag (UTF-8)
    centralHeader.writeUInt16LE(compressionMethod, 10); // Compression method
    centralHeader.writeUInt16LE(0, 12); // Last mod time
    centralHeader.writeUInt16LE(0, 14); // Last mod date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(compressedData.length, 20); // Compressed size
    centralHeader.writeUInt32LE(rawData.length, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBytes.length, 28); // Filename length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(localOffset, 42); // Relative offset of local header

    centralDirectory.push(centralHeader, nameBytes);

    localOffset +=
      localHeader.length + nameBytes.length + compressedData.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirectory);

  // End of central directory record (22 bytes)
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // Signature
  endRecord.writeUInt16LE(0, 4); // Number of this disk
  endRecord.writeUInt16LE(0, 6); // Disk where central directory starts
  endRecord.writeUInt16LE(orderedEntries.length, 8); // Number of central directory records on this disk
  endRecord.writeUInt16LE(orderedEntries.length, 10); // Total number of central directory records
  endRecord.writeUInt32LE(centralDirBuffer.length, 12); // Size of central directory
  endRecord.writeUInt32LE(localOffset, 16); // Offset of start of central directory
  endRecord.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localFiles, centralDirBuffer, endRecord]);
}
