import type { PublicationResource } from "@reflowpress/core";

export function normalizeResourcePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

export function resolveResourceHref(
  baseSectionHref: string,
  relativeTarget: string,
): string {
  // If target contains a URL scheme (e.g. http://, data:, blob:), return as is
  if (/^[a-z][a-z0-9+.-]*:/i.test(relativeTarget)) {
    return relativeTarget;
  }

  // If anchor only
  if (relativeTarget.startsWith("#")) {
    return relativeTarget;
  }

  const [pathPart, fragment] = relativeTarget.split("#", 2);
  const baseDir = baseSectionHref.includes("/")
    ? baseSectionHref.substring(0, baseSectionHref.lastIndexOf("/"))
    : "";

  const combined = baseDir ? `${baseDir}/${pathPart}` : pathPart;
  const normalized = normalizeResourcePath(combined ?? "");

  return fragment ? `${normalized}#${fragment}` : normalized;
}

export class PublicationResourceManager {
  private readonly blobUrls = new Map<string, string>();
  private readonly allUrls: string[] = [];

  constructor(resources: readonly PublicationResource[]) {
    for (const res of resources) {
      if (!res.bytes || res.bytes.length === 0) continue;
      const blob = new Blob([new Uint8Array(res.bytes)], {
        type: res.mediaType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      this.allUrls.push(url);

      // Register by exact href
      this.blobUrls.set(res.href, url);
      // Register by normalized href
      const normalized = normalizeResourcePath(res.href);
      this.blobUrls.set(normalized, url);
      // Register by filename only as fallback if unique
      const filename = normalized.split("/").pop();
      if (filename && !this.blobUrls.has(filename)) {
        this.blobUrls.set(filename, url);
      }
    }
  }

  public getBlobUrl(resolvedPath: string): string | undefined {
    const clean = resolvedPath.split("#", 1)[0] ?? "";
    const normalized = normalizeResourcePath(clean);
    return (
      this.blobUrls.get(clean) ??
      this.blobUrls.get(normalized) ??
      this.blobUrls.get(normalized.split("/").pop() ?? "")
    );
  }

  public dispose(): void {
    for (const url of this.allUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore errors on cleanup
      }
    }
    this.blobUrls.clear();
    this.allUrls.length = 0;
  }
}
