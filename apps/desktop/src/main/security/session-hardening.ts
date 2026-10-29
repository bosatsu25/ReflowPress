import type { Session, WebContents } from "electron";
import { isAppUrl } from "./app-protocol.js";

/**
 * Process-wide guards for every renderer: no permissions, no webviews, no
 * popups, no navigation away from the bundled app, and no network requests.
 * ReflowPress promises zero silent network activity; enforcing it here keeps
 * that promise even if a publication slips something past the sanitizer or
 * the CSP.
 */

/** Same host and port; the scheme may differ (http and ws for Vite HMR). */
export function hasOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).host === new URL(origin).host;
  } catch {
    return false;
  }
}

export function isAllowedRequestUrl(
  url: string,
  devServerOrigin: string | null,
): boolean {
  if (isAppUrl(url)) return true;
  if (url.startsWith("blob:") || url.startsWith("data:")) return true;
  if (url.startsWith("devtools://")) return true;
  // The Vite dev server (and its HMR websocket) only exists in development.
  return devServerOrigin !== null && hasOrigin(url, devServerOrigin);
}

export function isAllowedNavigation(
  url: string,
  devServerOrigin: string | null,
): boolean {
  if (isAppUrl(url)) return true;
  if (url.startsWith("devtools://")) return true;
  return devServerOrigin !== null && hasOrigin(url, devServerOrigin);
}

/** Subframes additionally load the sandboxed book iframe (srcdoc) and blobs. */
export function isAllowedFrameNavigation(
  url: string,
  devServerOrigin: string | null,
): boolean {
  if (url === "about:srcdoc" || url === "about:blank") return true;
  if (url.startsWith("blob:")) return true;
  return isAllowedNavigation(url, devServerOrigin);
}

export function hardenSession(
  session: Session,
  devServerOrigin: string | null,
): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequestUrl(details.url, devServerOrigin) });
  });
}

export function hardenWebContents(
  contents: WebContents,
  devServerOrigin: string | null,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, devServerOrigin)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedNavigation(url, devServerOrigin)) event.preventDefault();
  });
  contents.on("will-frame-navigate", (details) => {
    if (
      !details.isMainFrame &&
      !isAllowedFrameNavigation(details.url, devServerOrigin)
    ) {
      details.preventDefault();
    }
  });
}
