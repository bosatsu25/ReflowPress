import path from "node:path";

/**
 * Resolves an archive reference relative to a base directory inside the archive,
 * strictly validating against directory traversal and URI schemes.
 */
export function resolveArchiveReference(
  baseDirectory: string,
  rawReference: string,
): string {
  const reference = rawReference.split(/[?#]/, 1)[0] ?? "";
  if (
    reference.length === 0 ||
    reference.includes("\\") ||
    reference.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)
  ) {
    throw new Error("Reference must be a relative archive path.");
  }

  const decoded = decodeURIComponent(reference);
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)
  ) {
    throw new Error("Reference contains an unsafe path.");
  }

  const resolved = path.posix.normalize(
    path.posix.join(baseDirectory, decoded),
  );
  if (
    resolved === "." ||
    resolved === ".." ||
    resolved.startsWith("../") ||
    path.posix.isAbsolute(resolved)
  ) {
    throw new Error("Reference escapes the archive.");
  }
  return resolved;
}
