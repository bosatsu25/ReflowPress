import { type SyncSnapshot } from "./models.js";
import { serializeSyncBundle, deserializeSyncBundle } from "./bundle.js";

export interface WebdavSyncAdapterOptions {
  readonly remoteUrl: string;
  readonly username?: string | undefined;
  readonly password?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly allowInsecure?: boolean | undefined;
}

export class WebdavSyncAdapter {
  private readonly baseUrl: URL;
  private readonly authHeader?: string;
  private readonly timeoutMs: number;

  constructor(options: WebdavSyncAdapterOptions) {
    let url: URL;
    try {
      url = new URL(options.remoteUrl);
    } catch {
      throw new Error(
        `Invalid WebDAV URL: '${sanitizeUrl(options.remoteUrl)}'`,
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
    const res = await this.fetchWithTimeout(this.baseUrl.toString(), {
      method: "MKCOL",
    });

    // 201 Created or 405 Method Not Allowed (collection already exists) are acceptable
    if (!res.ok && res.status !== 405 && res.status !== 301) {
      // Check if it already exists via PROPFIND
      const propRes = await this.fetchWithTimeout(this.baseUrl.toString(), {
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

    const checkRes = await this.fetchWithTimeout(manifestUrl.toString(), {
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

    const manifestText = await checkRes.text();

    const fetchJson = async (filename: string): Promise<string> => {
      const fileUrl = new URL(
        filename,
        this.baseUrl.toString().replace(/\/?$/, "/"),
      );
      const r = await this.fetchWithTimeout(fileUrl.toString(), {
        method: "GET",
      });
      if (!r.ok) return "[]";
      return r.text();
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
      const res = await this.fetchWithTimeout(fileUrl.toString(), {
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

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "User-Agent": "ReflowPress/0.9 (WebDAV Sync Adapter)",
        ...(init.headers as Record<string, string> | undefined),
      };

      if (this.authHeader) {
        headers.Authorization = this.authHeader;
      }

      return await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.password) {
      u.password = "***";
    }
    return u.toString();
  } catch {
    return rawUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
  }
}
