import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpdsServer,
  parseByteRange,
  fetchRemoteOpdsFeed,
} from "../../packages/opds/src/index.js";
import { WebdavSyncAdapter } from "../../packages/sync/src/index.js";
import type { LibraryCatalog } from "../../packages/library/src/index.js";

function rawGet(
  port: number,
  requestPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: requestPath, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function close(server: http.Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe("parseByteRange (RFC 9110)", () => {
  it("handles full, bounded, open-ended and suffix ranges", () => {
    expect(parseByteRange(undefined, 100)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-9", 100)).toEqual({
      kind: "partial",
      start: 0,
      end: 9,
    });
    expect(parseByteRange("bytes=90-", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
    expect(parseByteRange("bytes=-10", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
    expect(parseByteRange("bytes=50-1000", 100)).toEqual({
      kind: "partial",
      start: 50,
      end: 99,
    });
  });

  it("rejects malformed, inverted, out-of-range and multi-range headers", () => {
    for (const header of [
      "bytes=-",
      "bytes=10-5",
      "bytes=100-",
      "bytes=-0",
      "bytes=0-1,5-6",
      "items=0-1",
      "bytes=abc",
    ]) {
      expect(parseByteRange(header, 100)).toEqual({ kind: "unsatisfiable" });
    }
    expect(parseByteRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("OpdsServer hardening", () => {
  let server: OpdsServer | null = null;
  let workDir = "";
  let catalog: LibraryCatalog;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "reflowpress-opds-"));
    const bookPath = path.join(workDir, "book.epub");
    await writeFile(bookPath, Buffer.from("0123456789"));
    catalog = {
      schemaVersion: 1,
      updatedAt: "2026-10-01T12:00:00.000Z",
      scanPaths: [],
      collections: [],
      books: [
        {
          id: "book-1",
          title: "Alpha",
          format: "epub",
          filePath: bookPath,
          fileSizeBytes: 10,
          modifiedTimeMs: 0,
          dateAdded: "2026-10-01T10:00:00.000Z",
          tags: [],
          collectionIds: [],
          availability: { exists: true, lastChecked: "2026-10-01T12:00:00Z" },
        },
        {
          id: "dir-book",
          title: "Directory",
          format: "epub",
          filePath: workDir,
          fileSizeBytes: 0,
          modifiedTimeMs: 0,
          dateAdded: "2026-10-01T10:00:00.000Z",
          tags: [],
          collectionIds: [],
          availability: { exists: true, lastChecked: "2026-10-01T12:00:00Z" },
        },
      ],
    };
  });

  afterEach(async () => {
    await server?.stop();
    server = null;
    await rm(workDir, { recursive: true, force: true });
  });

  it("refuses requests whose Host is not loopback (DNS rebinding)", async () => {
    server = new OpdsServer({ port: 0, getCatalog: () => catalog });
    const info = await server.start();

    const rebound = await rawGet(info.port, "/opds/v2/catalog", {
      Host: `attacker.example:${info.port}`,
    });
    expect(rebound.status).toBe(421);

    const direct = await rawGet(info.port, "/opds/v2/catalog", {
      Host: `127.0.0.1:${info.port}`,
    });
    expect(direct.status).toBe(200);
  });

  it("requires an access token to share on the network", () => {
    expect(
      () => new OpdsServer({ allowLan: true, getCatalog: () => catalog }),
    ).toThrow(/access token/);
  });

  it("serves the LAN catalog only under the access token prefix", async () => {
    const token = "s3cret-token-value";
    server = new OpdsServer({
      port: 0,
      allowLan: true,
      host: "127.0.0.1",
      accessToken: token,
      getCatalog: () => catalog,
    });
    const info = await server.start();
    expect(info.isLan).toBe(true);
    expect(info.url.endsWith(`/${token}`)).toBe(true);

    expect((await rawGet(info.port, "/opds/v2/catalog")).status).toBe(404);
    expect(
      (await rawGet(info.port, "/wrong-token/opds/v2/catalog")).status,
    ).toBe(404);

    const ok = await rawGet(info.port, `/${token}/opds/v2/catalog`);
    expect(ok.status).toBe(200);
    // Links in the feed carry the token so clients can follow them.
    expect(ok.body).toContain(`/${token}/opds/v2/publications/book-1`);
  });

  it("serves publication byte ranges and refuses directories", async () => {
    server = new OpdsServer({ port: 0, getCatalog: () => catalog });
    const info = await server.start();
    const base = `http://127.0.0.1:${info.port}/opds/v2/publications`;

    const suffix = await fetch(`${base}/book-1/acquisition`, {
      headers: { Range: "bytes=-3" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await suffix.text()).toBe("789");

    const unsatisfiable = await fetch(`${base}/book-1/acquisition`, {
      headers: { Range: "bytes=50-60" },
    });
    expect(unsatisfiable.status).toBe(416);
    await unsatisfiable.body?.cancel();

    const dir = await fetch(`${base}/dir-book/acquisition`);
    expect(dir.status).toBe(404);
    await dir.body?.cancel();
  });
});

describe("OPDS client hardening", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("stops reading a feed body as soon as it exceeds the cap", async () => {
    const { server, url } = await listen((_req, res) => {
      // No Content-Length: the cap must be enforced while streaming.
      res.writeHead(200, { "Content-Type": "application/opds+json" });
      res.write("x".repeat(4096));
      res.end("x".repeat(4096));
    });
    servers.push(server);

    await expect(fetchRemoteOpdsFeed(url, { maxBytes: 1024 })).rejects.toThrow(
      /exceeded maximum allowed size/,
    );
  });

  it("drops credential headers, whatever their case, on cross-origin redirects", async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const target = await listen((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "Content-Type": "application/opds+json" });
      res.end(
        JSON.stringify({
          metadata: { title: "Feed" },
          links: [],
          navigation: [],
        }),
      );
    });
    servers.push(target.server);
    const origin = await listen((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/feed` });
      res.end();
    });
    servers.push(origin.server);

    await fetchRemoteOpdsFeed(origin.url, {
      headers: { authorization: "Basic c2VjcmV0", Cookie: "session=1" },
    }).catch(() => undefined);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBeUndefined();
    expect(seen[0]?.cookie).toBeUndefined();
  });
});

describe("WebDAV adapter hardening", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("rejects credentials embedded in the URL", () => {
    expect(
      () =>
        new WebdavSyncAdapter({ remoteUrl: "https://user:pw@dav.example/x" }),
    ).toThrow(/not in the URL/);
  });

  it("applies the timeout to a server that stalls mid-body", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write("{"); // never finishes
    });
    servers.push(server);

    const adapter = new WebdavSyncAdapter({ remoteUrl: url, timeoutMs: 200 });
    await expect(adapter.readSnapshot()).rejects.toThrow(/timed out/);
  });

  it("refuses responses larger than the cap", async () => {
    const { server, url } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("x".repeat(10_000));
    });
    servers.push(server);

    const adapter = new WebdavSyncAdapter({
      remoteUrl: url,
      maxResponseBytes: 1_000,
    });
    await expect(adapter.readSnapshot()).rejects.toThrow(/too large|exceeded/);
  });

  it("does not follow redirects that would re-send credentials or bodies", async () => {
    const hits: string[] = [];
    const elsewhere = await listen((req, res) => {
      hits.push(req.method ?? "");
      res.writeHead(201);
      res.end();
    });
    servers.push(elsewhere.server);
    const { server, url } = await listen((_req, res) => {
      res.writeHead(307, { Location: `${elsewhere.url}/stolen` });
      res.end();
    });
    servers.push(server);

    const adapter = new WebdavSyncAdapter({
      remoteUrl: url,
      username: "user",
      password: "pw",
    });
    await expect(adapter.readSnapshot()).rejects.toThrow(/HTTP 307/);
    expect(hits).toEqual([]);
  });
});
