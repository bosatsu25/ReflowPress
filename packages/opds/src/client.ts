import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { parseOpdsFeed } from "./feed-parser.js";
import type { OpdsFeed } from "./models.js";

export interface OpdsFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export interface OpdsDownloadOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

export interface DownloadResult {
  readonly bytesWritten: number;
  readonly sha256: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_FEED_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_PUB_MAX_BYTES = 250 * 1024 * 1024; // 250 MiB

export function validateSafeUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: '${urlStr}'`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Disallowed URL protocol '${parsed.protocol}'. Only http: and https: are permitted.`,
    );
  }

  return parsed;
}

export async function fetchRemoteOpdsFeed(
  urlStr: string,
  options: OpdsFetchOptions = {},
): Promise<OpdsFeed> {
  const url = validateSafeUrl(urlStr);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_FEED_MAX_BYTES;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link external signal if present
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const headers: Record<string, string> = {
      Accept:
        "application/opds+json, application/atom+xml;profile=opds-catalog, application/json, text/xml, */*",
      "User-Agent":
        "ReflowPress/0.9 (OPDS Client; +https://github.com/bosatsu25/ReflowPress)",
      ...(options.headers ?? {}),
    };

    let currentUrl = url;
    let redirectCount = 0;
    const maxRedirects = 5;

    while (redirectCount <= maxRedirects) {
      const response = await fetch(currentUrl.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual",
      });

      // Handle redirect safely
      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `Redirect with status ${response.status} missing Location header.`,
          );
        }

        const nextUrl = validateSafeUrl(
          new URL(location, currentUrl).toString(),
        );

        // Strip Authorization header on cross-origin redirects
        if (nextUrl.origin !== currentUrl.origin && headers.Authorization) {
          delete headers.Authorization;
        }

        currentUrl = nextUrl;
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `OPDS request failed with HTTP ${response.status} ${response.statusText}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();

      if (Buffer.byteLength(text) > maxBytes) {
        throw new Error(
          `OPDS feed response exceeded maximum allowed size of ${maxBytes} bytes.`,
        );
      }

      return parseOpdsFeed(text, contentType);
    }

    throw new Error(`Too many redirects (exceeded limit of ${maxRedirects})`);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function downloadOpdsPublication(
  acquisitionUrl: string,
  destinationPath: string,
  options: OpdsDownloadOptions = {},
): Promise<DownloadResult> {
  const url = validateSafeUrl(acquisitionUrl);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBytes = options.maxBytes ?? DEFAULT_PUB_MAX_BYTES;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const tempPath = `${destinationPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const headers: Record<string, string> = {
      "User-Agent": "ReflowPress/0.9 (OPDS Acquisition Client)",
      ...(options.headers ?? {}),
    };

    let currentUrl = url;
    let redirectCount = 0;
    const maxRedirects = 5;
    let response: Response | null = null;

    while (redirectCount <= maxRedirects) {
      response = await fetch(currentUrl.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual",
      });

      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `Redirect status ${response.status} missing Location header.`,
          );
        }
        const nextUrl = validateSafeUrl(
          new URL(location, currentUrl).toString(),
        );
        if (nextUrl.origin !== currentUrl.origin && headers.Authorization) {
          delete headers.Authorization;
        }
        currentUrl = nextUrl;
        redirectCount++;
        continue;
      }

      break;
    }

    if (!response || !response.ok) {
      throw new Error(
        `Acquisition request failed with HTTP ${response?.status ?? "unknown"}`,
      );
    }

    if (!response.body) {
      throw new Error("Acquisition response body is empty");
    }

    // Stream download while calculating SHA-256 and checking byte bounds
    const hash = createHash("sha256");
    let totalBytes = 0;

    const meterTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          callback(
            new Error(
              `Publication download exceeded maximum allowed size of ${maxBytes} bytes.`,
            ),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    const fileStream = createWriteStream(tempPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeReadable = response.body as any;

    await pipeline(nodeReadable, meterTransform, fileStream);

    const sha256 = hash.digest("hex");

    // Atomically commit temp file to destination
    await fs.rename(tempPath, destinationPath);

    return {
      bytesWritten: totalBytes,
      sha256,
    };
  } catch (err) {
    // Cleanup temporary file on error
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
