export interface ResourceGraphNode {
  readonly path: string;
  readonly inManifest: boolean;
  readonly references: readonly string[];
}

export interface ResourceGraph {
  readonly manifestHrefs: ReadonlySet<string>;
  readonly referencedPaths: ReadonlySet<string>;
  readonly brokenReferences: readonly {
    sourceFile: string;
    targetRef: string;
  }[];
  readonly orphanFiles: readonly string[];
}

/**
 * Normalizes an internal reference path relative to the referring document's directory.
 * Preserves forward slashes and resolves '.' and '..' segments.
 */
export function resolveInternalPath(
  baseDocPath: string,
  relativeRef: string,
): string {
  // Strip fragment and query if present
  const cleanRef = relativeRef.split("#")[0]?.split("?")[0] ?? "";
  if (!cleanRef) return "";

  // If already absolute within zip (e.g. starts with '/')
  if (cleanRef.startsWith("/")) {
    return cleanRef.slice(1);
  }

  const baseDir = baseDocPath.includes("/")
    ? baseDocPath.slice(0, baseDocPath.lastIndexOf("/"))
    : "";
  const parts = baseDir ? baseDir.split("/") : [];

  for (const seg of cleanRef.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }

  return parts.join("/");
}

/**
 * Extracts referenced URLs/paths from XML/XHTML content (img src, link href, script src, a href).
 */
export function extractReferencesFromXml(xmlText: string): string[] {
  const refs: string[] = [];

  // Match src="..." or href="..." or poster="..."
  const attrRegex = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(xmlText)) !== null) {
    const val = match[1]?.trim();
    if (val && !isExternalOrSpecialUrl(val)) {
      refs.push(val);
    }
  }

  return refs;
}

/**
 * Extracts url(...) references from CSS content.
 */
export function extractReferencesFromCss(cssText: string): string[] {
  const refs: string[] = [];
  const cssUrlRegex = /\burl\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = cssUrlRegex.exec(cssText)) !== null) {
    const val = match[1]?.trim();
    if (val && !isExternalOrSpecialUrl(val)) {
      refs.push(val);
    }
  }
  return refs;
}

function isExternalOrSpecialUrl(url: string): boolean {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("javascript:") ||
    url.startsWith("#")
  );
}
