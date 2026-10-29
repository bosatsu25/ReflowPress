import path from "node:path";

/**
 * The renderer is served from a privileged custom scheme instead of file://.
 *
 * Under file://, Chromium treats every local file as same-origin with the
 * app, so CSP 'self' admits any file on disk (for example an EPUB that
 * references file:///C:/Users/...). Under app://reflowpress only the bundled
 * renderer files are reachable, and the handler refuses paths that escape
 * the renderer directory.
 */

export const APP_SCHEME = "app";
export const APP_HOST = "reflowpress";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`);
}

/**
 * Maps an app:// request URL to a file inside `rootDir`, or returns null when
 * the URL is malformed, targets another host, or resolves outside the root.
 */
export function resolveAppAssetPath(
  rootDir: string,
  requestUrl: string,
  pathImpl: path.PlatformPath = path,
): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  const root = pathImpl.resolve(rootDir);
  const resolved = pathImpl.resolve(root, `.${pathname}`);
  const relative = pathImpl.relative(root, resolved);
  if (
    relative === "" ||
    pathImpl.isAbsolute(relative) ||
    relative.split(pathImpl.sep)[0] === ".."
  ) {
    return null;
  }
  return resolved;
}
