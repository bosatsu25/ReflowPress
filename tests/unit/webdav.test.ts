import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import {
  WebdavSyncAdapter,
  sanitizeUrl,
  type SyncSnapshot,
} from "../../packages/sync/src/index.js";

describe("WebDAV Sync Adapter (RFC 4918) (@reflowpress/sync)", () => {
  let server: http.Server | null = null;
  let serverPort = 0;
  const recordedRequests: {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }[] = [];
  const serverFiles: Record<string, string> = {};

  const startTestWebdavServer = async (): Promise<string> => {
    return new Promise((resolve) => {
      server = http.createServer(async (req, res) => {
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        let body = "";
        for await (const chunk of req) {
          body += chunk;
        }

        recordedRequests.push({ method, url, headers: req.headers, body });

        const filename = url.replace(/^\//, "");

        if (method === "MKCOL") {
          res.writeHead(201, { "Content-Type": "text/plain" });
          res.end("Created");
          return;
        }

        if (method === "PROPFIND") {
          res.writeHead(207, { "Content-Type": "application/xml" });
          res.end("<multistatus xmlns='DAV:'></multistatus>");
          return;
        }

        if (method === "PUT") {
          serverFiles[filename] = body;
          res.writeHead(201, { "Content-Type": "text/plain" });
          res.end("Created");
          return;
        }

        if (method === "GET") {
          if (serverFiles[filename] !== undefined) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(serverFiles[filename]);
          } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
          }
          return;
        }

        res.writeHead(405);
        res.end("Method Not Allowed");
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server?.address();
        if (addr && typeof addr !== "string") {
          serverPort = addr.port;
          resolve(`http://127.0.0.1:${serverPort}`);
        }
      });
    });
  };

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    recordedRequests.length = 0;
    for (const key of Object.keys(serverFiles)) delete serverFiles[key];
  });

  describe("Security & URL Sanitization", () => {
    it("sanitizes passwords from WebDAV URLs", () => {
      const urlWithSecret =
        "https://user:SuperSecretPassword123@webdav.example.com/remote/sync/";
      const sanitized = sanitizeUrl(urlWithSecret);
      expect(sanitized).toBe(
        "https://user:***@webdav.example.com/remote/sync/",
      );
      expect(sanitized).not.toContain("SuperSecretPassword123");
    });

    it("enforces HTTPS on non-localhost remote endpoints by default", () => {
      expect(() => {
        new WebdavSyncAdapter({
          remoteUrl: "http://remote-nextcloud.example.com/webdav/",
          username: "user",
          password: "password",
        });
      }).toThrow(/WebDAV requires HTTPS by default/);
    });

    it("permits insecure HTTP on localhost/127.0.0.1 without error", () => {
      expect(() => {
        new WebdavSyncAdapter({
          remoteUrl: "http://127.0.0.1:8080/webdav/",
        });
      }).not.toThrow();
    });
  });

  describe("WebDAV Roundtrip Operations", () => {
    it("performs MKCOL, PUT, and GET operations with Basic authentication", async () => {
      const baseUrl = await startTestWebdavServer();
      const adapter = new WebdavSyncAdapter({
        remoteUrl: baseUrl,
        username: "syncuser",
        password: "secretpassword",
      });

      const snapshot: SyncSnapshot = {
        manifest: {
          schemaVersion: 1,
          bundleId: "webdav-bundle-1",
          createdAt: "2026-10-01T12:00:00.000Z",
          updatedAt: "2026-10-01T12:00:00.000Z",
          sourceInstallationId: "desktop-sync",
          counts: {
            books: 1,
            annotations: 0,
            bookmarks: 0,
            readingPositions: 0,
            tombstones: 0,
            conflicts: 0,
          },
        },
        books: [
          {
            id: "book-dav-1",
            rev: "rev-dav",
            updatedAt: "2026-10-01T12:00:00.000Z",
            installationId: "desktop-sync",
            data: {
              portableId: "dav-p1",
              title: "WebDAV Book",
              format: "epub",
            },
          },
        ],
        annotations: [],
        bookmarks: [],
        readingPositions: [],
        tombstones: [],
        conflicts: [],
      };

      // 1. Write snapshot
      await adapter.writeSnapshot(snapshot);

      // Verify that requests included the Authorization header
      const putReq = recordedRequests.find((r) => r.method === "PUT");
      expect(putReq).toBeDefined();
      expect(putReq?.headers.authorization).toMatch(/^Basic /);

      // 2. Read snapshot back
      const readBack = await adapter.readSnapshot();
      expect(readBack).not.toBeNull();
      expect(readBack?.manifest.bundleId).toBe("webdav-bundle-1");
      expect(readBack?.books).toHaveLength(1);
      expect(readBack?.books[0]?.data.title).toBe("WebDAV Book");
    });
  });
});
