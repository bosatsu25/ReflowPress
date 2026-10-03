import * as http from "node:http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { LibraryCatalog, LibraryBook } from "@reflowpress/library";
import { generateOpds2Catalog } from "./feed-generator.js";
import { OPDS2_MIME_TYPE } from "./models.js";

export interface OpdsServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly allowLan?: boolean;
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

export class OpdsServer {
  private server: http.Server | null = null;
  private readonly options: OpdsServerOptions;
  private activePort = 0;
  private activeHost = "127.0.0.1";

  constructor(options: OpdsServerOptions) {
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
          }
          console.error(
            "[OpdsServer Error]",
            err instanceof Error ? err.message : err,
          );
        });
      });

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

    return new Promise((resolve, reject) => {
      this.server?.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getInfo(): ServerInfo {
    const isLan = this.activeHost === "0.0.0.0";
    const displayHost = isLan ? "localhost" : this.activeHost;
    const url = `http://${displayHost}:${this.activePort}`;
    return {
      url,
      host: this.activeHost,
      port: this.activePort,
      isLan,
    };
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

    const hostHeader =
      req.headers.host ?? `${this.activeHost}:${this.activePort}`;
    const reqUrl = new URL(req.url ?? "/", `http://${hostHeader}`);
    const pathname = reqUrl.pathname;

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
        baseUrl: `http://${hostHeader}`,
        title: this.options.title ?? "ReflowPress Library",
        page,
        pageSize,
      });

      const body = JSON.stringify(feed, null, 2);
      const buffer = Buffer.from(body, "utf-8");
      const totalSize = buffer.byteLength;
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
        if (match) {
          const rawStart = match[1];
          const rawEnd = match[2];
          let start = rawStart ? parseInt(rawStart, 10) : 0;
          let end = rawEnd ? parseInt(rawEnd, 10) : totalSize - 1;
          if (isNaN(start)) start = 0;
          if (isNaN(end) || end >= totalSize) end = totalSize - 1;

          if (start <= end && start < totalSize) {
            const chunk = buffer.subarray(start, end + 1);
            res.writeHead(206, {
              "Content-Range": `bytes ${start}-${end}/${totalSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": chunk.byteLength,
              "Content-Type": `${OPDS2_MIME_TYPE}; charset=utf-8`,
            });
            if (req.method === "HEAD") {
              res.end();
            } else {
              res.end(chunk);
            }
            return;
          }
        }
      }

      res.writeHead(200, {
        "Content-Type": `${OPDS2_MIME_TYPE}; charset=utf-8`,
        "Content-Length": totalSize,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });

      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(buffer);
      }
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

      if (!book) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Publication not found in local library catalog.");
        return;
      }

      await this.servePublicationFile(book, req, res);
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

      await this.serveCoverFile(coverPath, req, res);
      return;
    }

    // Default: 404 Not Found
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }

  private async servePublicationFile(
    book: LibraryBook,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(book.filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Publication file is missing from local disk.");
      return;
    }

    const fileSize = stat.size;
    const mediaType =
      book.format === "epub" ? "application/epub+zip" : "application/pdf";
    const rangeHeader = req.headers.range;

    // Check for Range Request
    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Invalid Range Request");
        return;
      }

      const rawStart = match[1];
      const rawEnd = match[2];

      let start = rawStart ? parseInt(rawStart, 10) : 0;
      let end = rawEnd ? parseInt(rawEnd, 10) : fileSize - 1;

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= fileSize) end = fileSize - 1;

      if (start > end || start >= fileSize) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Range Not Satisfiable");
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mediaType,
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const stream = fs.createReadStream(book.filePath, { start, end });
      stream.pipe(res);
      return;
    }

    // Full 200 OK Response
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mediaType,
      "Accept-Ranges": "bytes",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(book.filePath);
    stream.pipe(res);
  }

  private async serveCoverFile(
    coverPath: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(coverPath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Cover file not accessible.");
      return;
    }

    const ext = coverPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": ext,
      "Cache-Control": "public, max-age=86400",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(coverPath);
    stream.pipe(res);
  }
}
