import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ZipEntry {
  readonly name: string;
  readonly contents: string | Uint8Array;
}

function crc32(contents: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of contents) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function createZip(entries: readonly ZipEntry[]): Buffer {
  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const contents =
      typeof entry.contents === "string"
        ? Buffer.from(entry.contents, "utf8")
        : Buffer.isBuffer(entry.contents)
          ? entry.contents
          : Buffer.from(entry.contents);
    const checksum = crc32(contents);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localFiles.push(localHeader, name, contents);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralDirectory.push(centralHeader, name);
    localOffset += localHeader.length + name.length + contents.length;
  }

  const directoryContents = Buffer.concat(centralDirectory);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(directoryContents.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localFiles, directoryContents, endRecord]);
}

async function main() {
  await mkdir(__dirname, { recursive: true });

  // 1. Generate Sample EPUB
  const epubEntries: ZipEntry[] = [
    { name: "mimetype", contents: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    },
    {
      name: "OEBPS/package.opf",
      contents: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:sample-epub-01</dc:identifier>
    <dc:title>ReflowPress Sample Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>ReflowPress Team</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>`,
    },
    {
      name: "OEBPS/style.css",
      contents: `body { font-family: serif; } h1 { color: #2563eb; }`,
    },
    {
      name: "OEBPS/nav.xhtml",
      contents: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Navigation</title></head>
  <body>
    <nav epub:type="toc">
      <h1>Table of Contents</h1>
      <ol>
        <li><a href="chapter1.xhtml">Chapter 1: The Beginning</a></li>
        <li><a href="chapter2.xhtml">Chapter 2: The Horizon</a></li>
      </ol>
    </nav>
  </body>
</html>`,
    },
    {
      name: "OEBPS/chapter1.xhtml",
      contents: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter 1: The Beginning</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>Chapter 1: The Beginning</h1>
    <p>Welcome to ReflowPress Workbench. This is the first chapter of our test publication.</p>
    <p>ReflowPress enables local-first reading and organizing of electronic publications.</p>
  </body>
</html>`,
    },
    {
      name: "OEBPS/chapter2.xhtml",
      contents: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Chapter 2: The Horizon</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>Chapter 2: The Horizon</h1>
    <p>This is the second chapter, reached through table of contents navigation or page step.</p>
    <p>Reflowable typography adjusts cleanly to reader settings and viewport sizing.</p>
  </body>
</html>`,
    },
  ];

  const epubZip = createZip(epubEntries);
  await writeFile(path.join(__dirname, "sample.epub"), epubZip);

  // 2. Generate Minimal Valid Multi-page PDF
  // Two-page PDF
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 53 >>
stream
BT
/F1 24 Tf
100 700 Td
(ReflowPress PDF Sample - Page 1) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
7 0 obj
<< /Length 53 >>
stream
BT
/F1 24 Tf
100 700 Td
(ReflowPress PDF Sample - Page 2) Tj
ET
endstream
endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000122 00000 n 
0000000251 00000 n 
0000000355 00000 n 
0000000424 00000 n 
0000000553 00000 n 
trailer
<< /Size 8 /Root 1 0 R >>
startxref
657
%%EOF
`;

  await writeFile(path.join(__dirname, "sample.pdf"), pdfContent, "utf8");
  console.log("Fixtures generated successfully.");
}

main().catch(console.error);
