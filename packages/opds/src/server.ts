import * as http from "node:http";
import * as fsp from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import type { LibraryCatalog, LibraryBook } from "@reflowpress/library";
import { generateOpds2Catalog } from "./feed-generator.js";
import { OPDS2_MIME_TYPE } from "./models.js";

export interface OpdsServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly allowLan?: boolean;
  /**
   * Secret path segment every request must start with
   * (`/<accessToken>/opds/v2/catalog`). Required when `allowLan` is set,
   * because anything on the network can otherwise download the library.
   */
  readonly accessToken?: string | undefined;
  readonly title?: string;
  readonly getCatalog: () => LibraryCatalog | Promise<LibraryCatalog>;
  readonly getCoverPath?: (
    book: LibraryBook,
  ) => string | null | Promise<string | null>;
}

export interface ServerInfo {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly isLan: boolean;
}

export type ByteRange =
  | { readonly kind: "full" }
  | { readonly kind: "partial"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

/**
 * Parses a single `bytes=` range (RFC 9110 §14.1.2) against a known size,
 * including suffix ranges (`bytes=-500` is the last 500 bytes). Multiple
 * ranges and malformed headers are unsatisfiable.
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (header === undefined) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "") || size === 0) {
    return { kind: "unsatisfiable" };
  }

  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) {
      return { kind: "unsatisfiable" };
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    return { kind: "unsatisfiable" };
  }
  if (start > end || start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

function coverMediaType(coverPath: string): string {
  const lower = coverPath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function tokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class OpdsServer {
  private server: http.Server | null = null;
  private readonly options: OpdsServerOptions;
  private activePort = 0;
  private activeHost = "127.0.0.1";

  constructor(options: OpdsServerOptions) {
    if (options.allowLan && !options.accessToken) {
      throw new Error(
        "An access token is required to share the OPDS catalog on the network.",
      );
    }
    this.options = options;
  }

  public async start(): Promise<ServerInfo> {
    if (this.server) {
      return this.getInfo();
    }

    const host = this.options.allowLan
      ? (this.options.host ?? "0.0.0.0")
      : "127.0.0.1";
    const port = this.options.port ?? 0; // 0 chooses a random available port

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Internal Server Error");
          } else {
            res.destroy();
          }
          console.error(
            "[OpdsServer Error]",
            err instanceof Error ? err.message : err,
          );
        });
      });
      // Bound how long slow or idle clients may hold a connection.
      server.headersTimeout = 15_000;
      server.requestTimeout = 30_000;
      server.setTimeout(60_000);

      server.on("error", (err) => {
        reject(err);
      });

      server.listen(port, host, () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("Unable to determine server listen address."));
          return;
        }

        this.server = server;
        this.activePort = addr.port;
        this.activeHost = host;
        resolve(this.getInfo());
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;

    return new Promise((resolve, reject) => {
      server.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
      server.closeAllConnections();
    });
  }

  public getInfo(): ServerInfo {
    const isLan = Boolean(this.options.allowLan);
    const displayHost =
      this.activeHost === "0.0.0.0" || this.activeHost === "::"
        ? "localhost"
        : this.activeHost;
    const prefix = this.options.accessToken
      ? `/${this.options.accessToken}`
      : "";
    const url = `http://${displayHost}:${this.activePort}${prefix}`;
    return {
      url,
      host: this.activeHost,
      port: this.activePort,
      isLan,
    };
  }

  /**
   * In loopback mode only requests addressed to a loopback name are served.
   * A web page that rebinds its own domain to 127.0.0.1 still sends its own
   * domain in Host, so it cannot read the catalog.
   */
  private isAcceptedHost(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    if (this.options.allowLan) return true;
    let parsed: URL;
    try {
      parsed = new URL(`http://${hostHeader}`);
    } catch {
      return false;
    }
    return (
      LOOPBACK_HOSTNAMES.has(parsed.hostname) &&
      parsed.port === String(this.activePort)
    );
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Only GET and HEAD are permitted (Read-Only)
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(
        "Method Not Allowed. ReflowPress OPDS server is strictly read-only.",
      );
      return;
    }

    const hostHeader = req.headers.host;
    if (!this.isAcceptedHost(hostHeader)) {
      res.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Misdirected Request");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://${hostHeader}`);
    let pathname = reqUrl.pathname;
    let baseUrl = `http://${hostHeader}`;

    const token = this.options.accessToken;
    if (token) {
      const segments = pathname.split("/");
      const presented = segments[1] ?? "";
      if (!tokensMatch(token, presented)) {
        this.notFound(res);
        return;
      }
      pathname = `/${segments.slice(2).join("/")}`;
      baseUrl = `${baseUrl}/${token}`;
    }

    // 1. Root Catalog Feed
    if (
      pathname === "/opds/v2/catalog" ||
      pathname === "/opds" ||
      pathname === "/"
    ) {
      const catalog = await this.options.getCatalog();
      const page = parseInt(reqUrl.searchParams.get("page") ?? "1", 10) || 1;
      const pageSize =
        parseInt(reqUrl.searchParams.get("pageSize") ?? "50", 10) || 50;

      const feed = generateOpds2Catalog(catalog, {
        baseUrl,
        title: this.options.title ?? "ReflowPress Library",
        page,
        pageSize,
      });

      const buffer = Buffer.from(JSON.stringify(feed, null, 2), "utf-8");
      const range = parseByteRange(req.headers.range, buffer.byteLength);

      if (range.kind === "partial") {
        const chunk = buffer.subarray(range.start, range.end + 1);
        res.writeHead(206, {
          ...SECURITY_HEADERS,
          "Content-Range": `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunk.byteLength,
          "Content-Type": `${OPDS2_MIME_TYPE}; charset=utf-8`,
        });
        res.end(req.method === "HEAD" ? undefined : chunk);
        return;
      }

      // Catalog ranges are a convenience; an unusable one gets the full feed.
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": `${OPDS2_MIME_TYPE}; charset=utf-8`,
        "Content-Length": buffer.byteLength,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : buffer);
      return;
    }

    // 2. Publication Acquisition: /opds/v2/publications/:id/acquisition
    const acquisitionMatch = pathname.match(
      /^\/opds\/v2\/publications\/([^/]+)\/acquisition$/,
    );
    if (acquisitionMatch) {
      const bookId = decodeURIComponent(acquisitionMatch[1] ?? "");
      const catalog = await this.options.getCatalog();
      const book = catalog.books.find((b) => b.id === bookId);

      if (!book || !book.filePath) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Publication not found in local library catalog.");
        return;
      }

      await this.serveFile(
        book.filePath,
        book.format === "epub" ? "application/epub+zip" : "application/pdf",
        req,
        res,
        { "Content-Disposition": contentDisposition(book.filePath) },
      );
      return;
    }

    // 3. Cover Image: /opds/v2/publications/:id/cover
    const coverMatch = pathname.match(
      /^\/opds\/v2\/publications\/([^/]+)\/cover$/,
    );
    if (coverMatch) {
      const bookId = decodeURIComponent(coverMatch[1] ?? "");
      const catalog = await this.options.getCatalog();
      const book = catalog.books.find((b) => b.id === bookId);

      if (!book || !this.options.getCoverPath) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Cover image not found.");
        return;
      }

      const coverPath = await this.options.getCoverPath(book);
      if (!coverPath) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No cover cached for publication.");
        return;
      }

      await this.serveFile(coverPath, coverMediaType(coverPath), req, res, {
        "Cache-Control": "public, max-age=86400",
      });
      return;
    }

    this.notFound(res);
  }

  private notFound(res: http.ServerResponse): void {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }

  /**
   * Opens the file once and serves from that handle, so the size check and
   * the bytes sent describe the same file, directories are refused, and the
   * descriptor is closed when the client disconnects or a read fails.
   */
  private async serveFile(
    filePath: string,
    mediaType: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    extraHeaders: Record<string, string>,
  ): Promise<void> {
    let handle: fsp.FileHandle;
    try {
      handle = await fsp.open(filePath, "r");
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("File is missing from local disk.");
      return;
    }

    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("File is missing from local disk.");
        return;
      }

      const range = parseByteRange(req.headers.range, stat.size);
      if (range.kind === "unsatisfiable") {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Range Not Satisfiable");
        return;
      }

      const headers: http.OutgoingHttpHeaders = {
        ...SECURITY_HEADERS,
        ...extraHeaders,
        "Content-Type": mediaType,
        "Accept-Ranges": "bytes",
      };
      let start = 0;
      let end = stat.size - 1;
      if (range.kind === "partial") {
        ({ start, end } = range);
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": end - start + 1,
        });
      } else {
        res.writeHead(200, { ...headers, "Content-Length": stat.size });
      }

      if (req.method === "HEAD" || stat.size === 0) {
        res.end();
        return;
      }

      await pipeline(
        handle.createReadStream({ start, end, autoClose: false }),
        res,
      ).catch(() => {
        // Client went away or the read failed mid-stream; nothing to send.
        res.destroy();
      });
    } finally {
      await handle.close().catch(() => {});
    }
  }
}

function contentDisposition(filePath: string): string {
  const name = basename(filePath);
  const asciiFallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
