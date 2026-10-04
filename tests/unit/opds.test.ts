import { describe, it, expect, afterEach } from "vitest";
import {
  generateOpds2Catalog,
  parseOpdsFeed,
  OpdsServer,
  validateSafeUrl,
  OPDS2_MIME_TYPE,
  OPDS_RELS,
} from "../../packages/opds/src/index.js";
import type { LibraryCatalog } from "../../packages/library/src/index.js";

describe("OPDS 2.0 Catalog & Server (@reflowpress/opds)", () => {
  const sampleCatalog: LibraryCatalog = {
    schemaVersion: 1,
    updatedAt: "2026-10-01T12:00:00.000Z",
    scanPaths: [],
    collections: [],
    books: [
      {
        id: "book-1",
        title: "Test Publication Alpha",
        creator: "Author Alpha",
        format: "epub",
        filePath: "/path/to/alpha.epub",
        fileSizeBytes: 10240,
        modifiedTimeMs: 1600000000000,
        dateAdded: "2026-10-01T10:00:00.000Z",
        tags: ["fiction", "japanese"],
        collectionIds: [],
        availability: { exists: true, lastChecked: "2026-10-01T12:00:00.000Z" },
      },
      {
        id: "book-2",
        title: "Test Publication Beta",
        creator: "Author Beta",
        format: "pdf",
        filePath: "/path/to/beta.pdf",
        fileSizeBytes: 20480,
        modifiedTimeMs: 1600000000000,
        dateAdded: "2026-10-01T11:00:00.000Z",
        tags: ["tech"],
        collectionIds: [],
        availability: { exists: true, lastChecked: "2026-10-01T12:00:00.000Z" },
      },
    ],
  };

  describe("generateOpds2Catalog", () => {
    it("generates valid OPDS 2.0 JSON structure", () => {
      const feed = generateOpds2Catalog({
        catalog: sampleCatalog,
        baseUrl: "http://127.0.0.1:3000",
      });

      expect(feed["@context"]).toContain(
        "https://readium.org/webpub-manifest/context.jsonld",
      );
      expect(feed.metadata.title).toBe("ReflowPress Library");
      expect(feed.publications).toHaveLength(2);

      const pub1 = feed.publications?.[0];
      expect(pub1?.metadata.title).toBe("Test Publication Alpha");
      expect(pub1?.metadata.author).toBe("Author Alpha");

      // Verify opaque acquisition link without filesystem paths
      const acqLink = pub1?.links.find((l) => l.rel === OPDS_RELS.ACQUISITION);
      expect(acqLink).toBeDefined();
      expect(acqLink?.href).toBe(
        "http://127.0.0.1:3000/opds/v2/publications/book-1/acquisition",
      );
      expect(acqLink?.type).toBe("application/epub+zip");
      expect(acqLink?.href).not.toContain("/path/to/alpha.epub");
    });

    it("supports pagination with page and itemsPerPage", () => {
      const feedPage1 = generateOpds2Catalog({
        catalog: sampleCatalog,
        baseUrl: "http://127.0.0.1:3000",
        page: 1,
        itemsPerPage: 1,
      });

      expect(feedPage1.publications).toHaveLength(1);
      expect(feedPage1.publications?.[0]?.metadata.title).toBe(
        "Test Publication Alpha",
      );

      const nextLink = feedPage1.links.find((l) => l.rel === OPDS_RELS.NEXT);
      expect(nextLink).toBeDefined();
      expect(nextLink?.href).toContain("page=2");
    });
  });

  describe("parseOpdsFeed", () => {
    it("parses OPDS 2.0 JSON feed", () => {
      const feedJson = JSON.stringify({
        metadata: { title: "Remote Catalog" },
        links: [{ rel: "self", href: "https://example.com/opds" }],
        publications: [
          {
            metadata: { title: "Remote Book 1", author: "Remote Author" },
            links: [
              {
                rel: "http://opds-spec.org/acquisition",
                href: "https://example.com/books/1.epub",
                type: "application/epub+zip",
              },
            ],
          },
        ],
      });

      const parsed = parseOpdsFeed(feedJson);
      expect(parsed.metadata.title).toBe("Remote Catalog");
      expect(parsed.publications).toHaveLength(1);
      expect(parsed.publications?.[0]?.metadata.title).toBe("Remote Book 1");
    });

    it("parses OPDS 2.0 links with array of rel values (e.g. open-access)", () => {
      const feedJson = JSON.stringify({
        metadata: { title: "Open Access Catalog" },
        links: [{ rel: "self", href: "https://example.com/opds" }],
        publications: [
          {
            metadata: { title: "Open Access Book" },
            links: [
              {
                rel: [
                  "http://opds-spec.org/acquisition",
                  "http://opds-spec.org/acquisition/open-access",
                ],
                href: "https://example.com/books/open.epub",
                type: "application/epub+zip",
              },
            ],
          },
        ],
      });

      const parsed = parseOpdsFeed(feedJson);
      const link = parsed.publications?.[0]?.links[0];
      expect(Array.isArray(link?.rel)).toBe(true);
      expect(link?.rel).toContain(
        "http://opds-spec.org/acquisition/open-access",
      );
    });

    it("parses legacy OPDS 1.2 Atom XML fallback", () => {
      const atomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Legacy Feed</title>
  <entry>
    <title>Legacy Book</title>
    <author><name>Legacy Author</name></author>
    <link rel="http://opds-spec.org/acquisition" href="https://example.com/legacy.epub" type="application/epub+zip"/>
  </entry>
</feed>`;

      const parsed = parseOpdsFeed(atomXml);
      expect(parsed.metadata.title).toBe("Legacy Feed");
      expect(parsed.publications).toHaveLength(1);
      expect(parsed.publications?.[0]?.metadata.title).toBe("Legacy Book");
      expect(parsed.publications?.[0]?.metadata.author).toBe("Legacy Author");
    });
  });

  describe("validateSafeUrl", () => {
    it("accepts valid http and https URLs", () => {
      expect(validateSafeUrl("http://localhost:3000/feed").protocol).toBe(
        "http:",
      );
      expect(
        validateSafeUrl("https://books.example.com/opds.json").protocol,
      ).toBe("https:");
    });

    it("rejects dangerous or unsupported protocols", () => {
      expect(() => validateSafeUrl("file:///etc/passwd")).toThrow(
        /Disallowed URL protocol/,
      );
      expect(() => validateSafeUrl("ftp://ftp.example.com")).toThrow(
        /Disallowed URL protocol/,
      );
      expect(() => validateSafeUrl("javascript:alert(1)")).toThrow(
        /Disallowed URL protocol/,
      );
      expect(() => validateSafeUrl("not a url")).toThrow(/Invalid URL/);
    });
  });

  describe("OpdsServer (HTTP Loopback Server)", () => {
    let server: OpdsServer | null = null;

    afterEach(async () => {
      if (server) {
        await server.stop();
        server = null;
      }
    });

    it("starts on loopback 127.0.0.1 by default and serves OPDS 2.0 catalog", async () => {
      server = new OpdsServer({
        port: 0, // Pick dynamic free port
        allowLan: false,
        getCatalog: () => sampleCatalog,
      });

      const info = await server.start();
      expect(info.isLan).toBe(false);
      expect(info.host).toBe("127.0.0.1");
      expect(info.port).toBeGreaterThan(0);

      const res = await fetch(`${info.url}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(OPDS2_MIME_TYPE);

      const data = (await res.json()) as {
        metadata: { title: string };
        publications: unknown[];
      };
      expect(data.metadata.title).toBe("ReflowPress Library");
      expect(data.publications).toHaveLength(2);
    });

    it("rejects non-GET/HEAD mutations with 405 Method Not Allowed", async () => {
      server = new OpdsServer({
        port: 0,
        getCatalog: () => sampleCatalog,
      });
      const info = await server.start();

      const postRes = await fetch(`${info.url}`, {
        method: "POST",
        body: "test",
      });
      expect(postRes.status).toBe(405);

      const deleteRes = await fetch(`${info.url}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(405);
    });

    it("handles HTTP Range requests properly", async () => {
      server = new OpdsServer({
        port: 0,
        getCatalog: () => sampleCatalog,
      });
      const info = await server.start();

      // Request range of catalog bytes
      const rangeRes = await fetch(`${info.url}`, {
        headers: { Range: "bytes=0-49" },
      });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get("content-range")).toMatch(
        /^bytes 0-49\/\d+$/,
      );
      const text = await rangeRes.text();
      expect(text.length).toBe(50);
    });
  });
});
