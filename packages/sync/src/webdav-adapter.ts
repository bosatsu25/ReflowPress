import { type SyncSnapshot } from "./models.js";
import { serializeSyncBundle, deserializeSyncBundle } from "./bundle.js";

export interface WebdavSyncAdapterOptions {
  readonly remoteUrl: string;
  readonly username?: string | undefined;
  readonly password?: string | undefined;
  /** Covers the whole exchange, including reading the response body. */
  readonly timeoutMs?: number | undefined;
  readonly allowInsecure?: boolean | undefined;
  /** Largest response body accepted, after decompression. */
  readonly maxResponseBytes?: number | undefined;
}

export const DEFAULT_WEBDAV_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

interface WebdavResponse {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly body: string;
}

export class WebdavSyncAdapter {
  private readonly baseUrl: URL;
  private readonly authHeader?: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: WebdavSyncAdapterOptions) {
    let url: URL;
    try {
      url = new URL(options.remoteUrl);
    } catch {
      throw new Error(
        `Invalid WebDAV URL: '${sanitizeUrl(options.remoteUrl)}'`,
      );
    }

    if (url.username || url.password) {
      // fetch() refuses such URLs and echoes them, password included, in
      // its error message.
      throw new Error(
        "Put WebDAV credentials in the username and password fields, not in the URL.",
      );
    }

    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (url.protocol !== "https:" && !isLocalhost && !options.allowInsecure) {
      throw new Error(
        `WebDAV requires HTTPS by default. Insecure HTTP is only permitted on localhost or with explicit allowInsecure opt-in.`,
      );
    }

    this.baseUrl = url;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_WEBDAV_MAX_RESPONSE_BYTES;

    if (options.username && options.password) {
      const token = Buffer.from(
        `${options.username}:${options.password}`,
      ).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  public getSanitizedUrl(): string {
    return sanitizeUrl(this.baseUrl.toString());
  }

  public async ensureCollection(): Promise<void> {
    const res = await this.request(this.baseUrl.toString(), {
      method: "MKCOL",
    });

    // 201 Created or 405 Method Not Allowed (collection already exists) are acceptable
    if (!res.ok && res.status !== 405 && res.status !== 301) {
      // Check if it already exists via PROPFIND
      const propRes = await this.request(this.baseUrl.toString(), {
        method: "PROPFIND",
        headers: { Depth: "0" },
      });
      if (!propRes.ok) {
        throw new Error(
          `Failed to initialize WebDAV collection: HTTP ${res.status} ${res.statusText}`,
        );
      }
    }
  }

  public async readSnapshot(): Promise<SyncSnapshot | null> {
    const manifestUrl = new URL(
      "manifest.json",
      this.baseUrl.toString().replace(/\/?$/, "/"),
    );

    const checkRes = await this.request(manifestUrl.toString(), {
      method: "GET",
    });

    if (checkRes.status === 404) {
      return null;
    }

    if (!checkRes.ok) {
      throw new Error(
        `Failed to check WebDAV manifest: HTTP ${checkRes.status} ${checkRes.statusText}`,
      );
    }

    const manifestText = checkRes.body;

    const fetchJson = async (filename: string): Promise<string> => {
      const fileUrl = new URL(
        filename,
        this.baseUrl.toString().replace(/\/?$/, "/"),
      );
      const r = await this.request(fileUrl.toString(), {
        method: "GET",
      });
      if (!r.ok) return "[]";
      return r.body;
    };

    const libraryText = await fetchJson("library.json");
    const annotationsText = await fetchJson("annotations.json");
    const readerStateText = await fetchJson("reader-state.json");
    const tombstonesText = await fetchJson("tombstones.json");
    const conflictsText = await fetchJson("conflicts.json");

    return deserializeSyncBundle({
      "manifest.json": manifestText,
      "library.json": libraryText,
      "annotations.json": annotationsText,
      "reader-state.json": readerStateText,
      "tombstones.json": tombstonesText,
      "conflicts.json": conflictsText,
    });
  }

  public async writeSnapshot(snapshot: SyncSnapshot): Promise<void> {
    await this.ensureCollection();

    const files = serializeSyncBundle(snapshot);
    const baseWithSlash = this.baseUrl.toString().replace(/\/?$/, "/");

    for (const [filename, content] of Object.entries(files)) {
      const fileUrl = new URL(filename, baseWithSlash);
      const res = await this.request(fileUrl.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: content,
      });

      if (!res.ok && res.status !== 201 && res.status !== 204) {
        throw new Error(
          `Failed to upload '${filename}' to WebDAV server: HTTP ${res.status} ${res.statusText}`,
        );
      }
    }
  }

  /**
   * Sends one request and reads the whole body under a single deadline and
   * byte cap. Redirects are never followed: the HTTPS check above only holds
   * for the configured origin, and a 307/308 would re-send PUT bodies.
   */
  private async request(
    url: string,
    init: RequestInit,
  ): Promise<WebdavResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "User-Agent": "ReflowPress (WebDAV Sync Adapter)",
        ...(init.headers as Record<string, string> | undefined),
      };

      if (this.authHeader) {
        headers.Authorization = this.authHeader;
      }

      const res = await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      const body = await readBodyCapped(res, this.maxResponseBytes);
      const redirected = res.status >= 300 && res.status < 400;
      return {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok && !redirected,
        body,
      };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(
          `WebDAV request timed out after ${this.timeoutMs} ms.`,
          { cause: err },
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(
      `WebDAV response is too large (${declared} bytes; limit ${maxBytes}).`,
    );
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`WebDAV response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.password) {
      u.password = "***";
    }
    return u.toString();
  } catch {
    // Hide the whole userinfo, which may itself contain "@" or ":".
    return rawUrl.replace(/:\/\/[^/?#]*@/, "://***@");
  }
}
