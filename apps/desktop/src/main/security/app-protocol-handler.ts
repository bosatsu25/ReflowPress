import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Protocol } from "electron";
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  resolveAppAssetPath,
} from "./app-protocol.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
};

/**
 * Serves the bundled renderer over app://reflowpress. Files are read
 * directly rather than through net.fetch(file://), so the session-wide
 * network block never has to make an exception for file:// URLs.
 */
export function registerAppProtocolHandler(
  protocol: Protocol,
  rendererRoot: string,
): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppAssetPath(rendererRoot, request.url);
    if (!filePath) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const body = await readFile(filePath);
      const mimeType =
        MIME_TYPES[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream";
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          "Content-Security-Policy": CONTENT_SECURITY_POLICY,
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  });
}
