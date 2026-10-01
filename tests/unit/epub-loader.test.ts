import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EpubLoader,
  EpubLoadingError,
  loadEpub,
} from "../../packages/epub/src/index.js";

interface ZipEntry {
  readonly name: string;
  readonly contents: string | Uint8Array;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("EpubLoader and loadEpub", () => {
  describe("EPUB 3 publication loading", () => {
    it("loads minimal valid EPUB 3 publication with reading order, navigation, and metadata", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "OPS/package.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Test EPUB 3</dc:title>
                <dc:language>ja</dc:language>
                <dc:identifier>urn:uuid:test-epub3</dc:identifier>
                <dc:creator>Test Author</dc:creator>
              </metadata>
              <manifest>
                <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
                <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine>
                <itemref idref="chapter1"/>
              </spine>
            </package>`,
        },
        {
          name: "OPS/nav.xhtml",
          contents: `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <nav epub:type="toc">
                  <h1>Table of Contents</h1>
                  <ol>
                    <li><a href="chapter1.xhtml">Chapter 1</a></li>
                  </ol>
                </nav>
              </body>
            </html>`,
        },
        {
          name: "OPS/chapter1.xhtml",
          contents: `<?xml version="1.0" encoding="utf-8"?>
            <html xmlns="http://www.w3.org/1999/xhtml">
              <body>
                <h1>Chapter 1</h1>
                <p>Hello ReflowPress!</p>
              </body>
            </html>`,
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.version).toBe("3.0");
      expect(pub.metadata.title).toBe("Test EPUB 3");
      expect(pub.metadata.language).toBe("ja");
      expect(pub.metadata.identifier).toBe("urn:uuid:test-epub3");
      expect(pub.metadata.creator).toEqual(["Test Author"]);

      expect(pub.readingOrder).toHaveLength(1);
      expect(pub.readingOrder[0]?.id).toBe("chapter1");
      expect(pub.readingOrder[0]?.href).toBe("chapter1.xhtml");
      expect(pub.readingOrder[0]?.mediaType).toBe("application/xhtml+xml");
      expect(pub.readingOrder[0]?.linear).toBe(true);
      expect(pub.readingOrder[0]?.markup).toContain("Hello ReflowPress!");

      expect(pub.navigation).toBeDefined();
      expect(pub.navigation).toHaveLength(1);
      expect(pub.navigation?.[0]?.label).toBe("Chapter 1");
      expect(pub.navigation?.[0]?.href).toBe("OPS/chapter1.xhtml");
    });

    it("preserves spine reading order and linear flag", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "OPS/package.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Multi Chapter</dc:title>
              </metadata>
              <manifest>
                <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
                <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
                <item id="appendix" href="app.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine>
                <itemref idref="ch1"/>
                <itemref idref="ch2"/>
                <itemref idref="appendix" linear="no"/>
              </spine>
            </package>`,
        },
        {
          name: "OPS/ch1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Ch1</body></html>',
        },
        {
          name: "OPS/ch2.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Ch2</body></html>',
        },
        {
          name: "OPS/app.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Appendix</body></html>',
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.readingOrder).toHaveLength(3);
      expect(pub.readingOrder.map((s) => s.id)).toEqual([
        "ch1",
        "ch2",
        "appendix",
      ]);
      expect(pub.readingOrder[0]?.linear).toBe(true);
      expect(pub.readingOrder[1]?.linear).toBe(true);
      expect(pub.readingOrder[2]?.linear).toBe(false);
    });

    it("parses nested navigation in EPUB 3 NavDoc", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Nested Nav</dc:title>
              </metadata>
              <manifest>
                <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
                <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine>
                <itemref idref="ch1"/>
              </spine>
            </package>`,
        },
        {
          name: "nav.xhtml",
          contents: `<?xml version="1.0"?>
            <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <nav epub:type="toc">
                  <ol>
                    <li>
                      <a href="ch1.xhtml">Part 1</a>
                      <ol>
                        <li><a href="ch1.xhtml#section1">Section 1.1</a></li>
                        <li><a href="ch1.xhtml#section2">Section 1.2</a></li>
                      </ol>
                    </li>
                  </ol>
                </nav>
              </body>
            </html>`,
        },
        {
          name: "ch1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Ch1</body></html>',
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.navigation).toHaveLength(1);
      const part1 = pub.navigation?.[0];
      expect(part1?.label).toBe("Part 1");
      expect(part1?.href).toBe("ch1.xhtml");
      expect(part1?.children).toHaveLength(2);
      expect(part1?.children?.[0]?.label).toBe("Section 1.1");
      expect(part1?.children?.[0]?.href).toBe("ch1.xhtml#section1");
      expect(part1?.children?.[1]?.label).toBe("Section 1.2");
      expect(part1?.children?.[1]?.href).toBe("ch1.xhtml#section2");
    });

    it("loads auxiliary resources such as CSS, images, and fonts", async () => {
      const cssBytes = Buffer.from("body { color: black; }", "utf8");
      const fakeImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "OPS/package.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Resources Test</dc:title>
              </metadata>
              <manifest>
                <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
                <item id="style" href="styles/main.css" media-type="text/css"/>
                <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
              </manifest>
              <spine>
                <itemref idref="ch1"/>
              </spine>
            </package>`,
        },
        {
          name: "OPS/text/ch1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Ch1</body></html>',
        },
        { name: "OPS/styles/main.css", contents: cssBytes },
        { name: "OPS/images/cover.jpg", contents: fakeImageBytes },
      ]);

      const pub = await loadEpub(path);

      expect(pub.resources).toHaveLength(2);
      const styleRes = pub.resources.find((r) => r.href === "styles/main.css");
      const coverRes = pub.resources.find((r) => r.href === "images/cover.jpg");

      expect(styleRes).toBeDefined();
      expect(styleRes?.mediaType).toBe("text/css");
      expect(new TextDecoder().decode(styleRes?.bytes)).toBe(
        "body { color: black; }",
      );

      expect(coverRes).toBeDefined();
      expect(coverRes?.mediaType).toBe("image/jpeg");
      expect(coverRes?.bytes).toEqual(fakeImageBytes);
    });

    it("parses rich metadata including layout properties and reading direction", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Fixed Layout Manga</dc:title>
                <dc:language>ja</dc:language>
                <dc:identifier>manga-123</dc:identifier>
                <dc:publisher>Sample Publishing</dc:publisher>
                <dc:description>A sample fixed-layout manga</dc:description>
                <dc:rights>All rights reserved</dc:rights>
                <meta property="dcterms:modified">2026-10-02T00:00:00Z</meta>
                <meta property="rendition:layout">pre-paginated</meta>
                <meta property="rendition:orientation">landscape</meta>
                <meta property="rendition:spread">both</meta>
              </metadata>
              <manifest>
                <item id="page1" href="p1.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine page-progression-direction="rtl">
                <itemref idref="page1"/>
              </spine>
            </package>`,
        },
        {
          name: "p1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>P1</body></html>',
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.metadata.title).toBe("Fixed Layout Manga");
      expect(pub.metadata.language).toBe("ja");
      expect(pub.metadata.identifier).toBe("manga-123");
      expect(pub.metadata.publisher).toBe("Sample Publishing");
      expect(pub.metadata.description).toBe("A sample fixed-layout manga");
      expect(pub.metadata.rights).toBe("All rights reserved");
      expect(pub.metadata.modified).toBe("2026-10-02T00:00:00Z");
      expect(pub.metadata.renditionLayout).toBe("pre-paginated");
      expect(pub.metadata.renditionOrientation).toBe("landscape");
      expect(pub.metadata.renditionSpread).toBe("both");
      expect(pub.metadata.direction).toBe("rtl");
    });
  });

  describe("EPUB 2 compatibility loading", () => {
    it("loads minimal valid EPUB 2 publication with NCX navigation", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "OEBPS/content.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>Legacy EPUB 2</dc:title>
                <dc:language>en</dc:language>
                <dc:identifier id="BookId">urn:uuid:legacy-epub2</dc:identifier>
                <dc:creator>Old Author</dc:creator>
              </metadata>
              <manifest>
                <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
                <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine toc="ncx">
                <itemref idref="chap1"/>
              </spine>
            </package>`,
        },
        {
          name: "OEBPS/toc.ncx",
          contents: `<?xml version="1.0"?>
            <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
              <head><meta name="dtb:uid" content="urn:uuid:legacy-epub2"/></head>
              <docTitle><text>Legacy EPUB 2</text></docTitle>
              <navMap>
                <navPoint id="navPoint-1" playOrder="1">
                  <navLabel><text>First Chapter</text></navLabel>
                  <content src="chap1.xhtml"/>
                </navPoint>
              </navMap>
            </ncx>`,
        },
        {
          name: "OEBPS/chap1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>First Chapter</h1></body></html>',
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.version).toBe("2.0");
      expect(pub.metadata.title).toBe("Legacy EPUB 2");
      expect(pub.readingOrder).toHaveLength(1);
      expect(pub.readingOrder[0]?.id).toBe("chap1");
      expect(pub.readingOrder[0]?.markup).toContain("First Chapter");

      expect(pub.navigation).toBeDefined();
      expect(pub.navigation).toHaveLength(1);
      expect(pub.navigation?.[0]?.label).toBe("First Chapter");
      expect(pub.navigation?.[0]?.href).toBe("OEBPS/chap1.xhtml");
    });

    it("parses nested NCX navigation", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "content.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Nested NCX</dc:title></metadata>
              <manifest>
                <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
                <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine toc="ncx"><itemref idref="c1"/></spine>
            </package>`,
        },
        {
          name: "toc.ncx",
          contents: `<?xml version="1.0"?>
            <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
              <navMap>
                <navPoint id="p1">
                  <navLabel><text>Volume 1</text></navLabel>
                  <content src="c1.xhtml#v1"/>
                  <navPoint id="p1-1">
                    <navLabel><text>Chapter 1.1</text></navLabel>
                    <content src="c1.xhtml#c1-1"/>
                  </navPoint>
                </navPoint>
              </navMap>
            </ncx>`,
        },
        {
          name: "c1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>C1</body></html>',
        },
      ]);

      const pub = await loadEpub(path);

      expect(pub.navigation).toHaveLength(1);
      const v1 = pub.navigation?.[0];
      expect(v1?.label).toBe("Volume 1");
      expect(v1?.href).toBe("c1.xhtml#v1");
      expect(v1?.children).toHaveLength(1);
      expect(v1?.children?.[0]?.label).toBe("Chapter 1.1");
      expect(v1?.children?.[0]?.href).toBe("c1.xhtml#c1-1");
    });
  });

  describe("PublicationAdapter conformance", () => {
    it("conforms to EpubPublicationAdapter interface", async () => {
      const loader = new EpubLoader();
      expect(loader.id).toBe("epub");

      expect(
        loader.canRead({
          path: "book.epub",
          mediaType: "application/epub+zip",
        }),
      ).toBe(true);
      expect(
        loader.canRead({
          path: "MY_BOOK.EPUB",
          mediaType: "application/octet-stream",
        }),
      ).toBe(true);
      expect(
        loader.canRead({ path: "document.pdf", mediaType: "application/pdf" }),
      ).toBe(false);

      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Adapter Test</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        {
          name: "c1.xhtml",
          contents:
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>Test</body></html>',
        },
      ]);

      const pub = await loader.read({
        path,
        mediaType: "application/epub+zip",
      });
      expect(pub.metadata.title).toBe("Adapter Test");
    });
  });

  describe("Security and error handling", () => {
    it("detects DRM encryption and rejects with DRM_PROTECTED_PUBLICATION", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/encryption.xml",
          contents:
            '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>',
        },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents:
            '<package version="3.0"><metadata/><manifest/><spine/></package>',
        },
      ]);

      await expect(loadEpub(path)).rejects.toSatisfy((err) => {
        return (
          err instanceof EpubLoadingError &&
          err.code === "DRM_PROTECTED_PUBLICATION"
        );
      });
    });

    it("rejects when a content document in spine is missing", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Missing Content</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        // c1.xhtml is intentionally missing
      ]);

      await expect(loadEpub(path)).rejects.toMatchObject({
        code: "MANIFEST_REFERENCE_NOT_FOUND",
      });
    });

    it("rejects when XHTML content document is malformed XML", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Malformed XML</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        {
          name: "c1.xhtml",
          contents: "<html><body><unclosed-tag></body></html>",
        },
      ]);

      await expect(loadEpub(path)).rejects.toMatchObject({
        code: "INVALID_CONTENT_DOCUMENT",
      });
    });

    it("rejects XHTML content declaring a DOCTYPE to prevent DTD attacks", async () => {
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>DTD Content</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        {
          name: "c1.xhtml",
          contents:
            '<!DOCTYPE html SYSTEM "http://evil.com/dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body>DTD</body></html>',
        },
      ]);

      await expect(loadEpub(path)).rejects.toMatchObject({
        code: "INVALID_CONTENT_DOCUMENT",
      });
    });

    it("enforces configured limits on content document size", async () => {
      const largeContent = `<html><body>${"A".repeat(500)}</body></html>`;
      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Large</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        { name: "c1.xhtml", contents: largeContent },
      ]);

      await expect(
        loadEpub(path, { maxMarkupBytes: 200 }),
      ).rejects.toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
      });
    });

    it("does not fetch external URLs and safely preserves remote references in markup", async () => {
      const markupWithExternal = `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
          <head>
            <link rel="stylesheet" href="http://external.example.com/style.css"/>
          </head>
          <body>
            <img src="https://tracking.example.com/pixel.png" alt="tracker"/>
            <p>Content</p>
          </body>
        </html>`;

      const path = await createEpub([
        { name: "mimetype", contents: "application/epub+zip" },
        {
          name: "META-INF/container.xml",
          contents:
            '<container><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        },
        {
          name: "book.opf",
          contents: `<?xml version="1.0"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Remote</dc:title></metadata>
              <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="c1"/></spine>
            </package>`,
        },
        { name: "c1.xhtml", contents: markupWithExternal },
      ]);

      const pub = await loadEpub(path);
      // Verify markup is loaded as raw string without attempting network fetches
      expect(pub.readingOrder[0]?.markup).toContain(
        "http://external.example.com/style.css",
      );
      expect(pub.readingOrder[0]?.markup).toContain(
        "https://tracking.example.com/pixel.png",
      );
    });
  });
});

async function createEpub(entries: readonly ZipEntry[]) {
  return createFile(createZip(entries));
}

async function createFile(contents: Uint8Array) {
  const directory = await mkdtemp(
    join(tmpdir(), "reflowpress-epub-loader-test-"),
  );
  temporaryDirectories.push(directory);
  const path = join(directory, "fixture.epub");
  await writeFile(path, contents);
  return path;
}

function createZip(entries: readonly ZipEntry[]) {
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

function crc32(contents: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of contents) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
