import path from "node:path";

/**
 * Capability-style file access for IPC handlers.
 *
 * The renderer displays untrusted publications, so the main process must not
 * read or write a path just because the renderer asked for it. A path is
 * usable only after the user picked it in a native dialog (or it came from the
 * main process's own state, such as the launch argument). Directory grants
 * cover everything inside the chosen directory.
 */

export type PathAccess = "read" | "write";

interface PathGrant {
  readonly target: string;
  readonly kind: "file" | "directory";
  readonly access: ReadonlySet<PathAccess>;
}

export class PathAccessDeniedError extends Error {
  constructor(purpose: string) {
    super(
      `Access denied: ${purpose} requires a location chosen in a ReflowPress file dialog.`,
    );
    this.name = "PathAccessDeniedError";
  }
}

export class PathGrantRegistry {
  private readonly grants: PathGrant[] = [];

  constructor(private readonly pathImpl: path.PlatformPath = path) {}

  grantFile(filePath: string, access: readonly PathAccess[]): string {
    return this.add(filePath, "file", access);
  }

  grantDirectory(dirPath: string, access: readonly PathAccess[]): string {
    return this.add(dirPath, "directory", access);
  }

  isGranted(target: string, access: PathAccess): boolean {
    const key = this.key(target);
    return this.grants.some((grant) => {
      if (!grant.access.has(access)) return false;
      if (grant.kind === "file") return grant.target === key;
      return this.isWithin(grant.target, key);
    });
  }

  /**
   * Returns the absolute path when `target` is granted for `access`, and
   * throws otherwise. Non-string input is rejected the same way.
   */
  require(target: unknown, access: PathAccess, purpose: string): string {
    if (typeof target !== "string" || target.length === 0) {
      throw new PathAccessDeniedError(purpose);
    }
    if (target.includes("\0") || !this.isGranted(target, access)) {
      throw new PathAccessDeniedError(purpose);
    }
    return this.pathImpl.resolve(target);
  }

  private add(
    target: string,
    kind: PathGrant["kind"],
    access: readonly PathAccess[],
  ): string {
    const resolved = this.pathImpl.resolve(target);
    this.grants.push({
      target: this.key(resolved),
      kind,
      access: new Set(access),
    });
    return resolved;
  }

  private key(target: string): string {
    const resolved = this.pathImpl.resolve(target);
    // NTFS paths are case-insensitive; compare them that way so a grant
    // cannot be sidestepped (or spuriously missed) by changing case.
    return this.pathImpl.sep === "\\" ? resolved.toLowerCase() : resolved;
  }

  private isWithin(dir: string, target: string): boolean {
    const relative = this.pathImpl.relative(dir, target);
    if (relative === "") return true;
    if (this.pathImpl.isAbsolute(relative)) return false;
    return relative.split(this.pathImpl.sep)[0] !== "..";
  }
}

/** Compares two paths the way the host file system would. */
export function samePath(
  a: string,
  b: string,
  pathImpl: path.PlatformPath = path,
): boolean {
  const left = pathImpl.resolve(a);
  const right = pathImpl.resolve(b);
  return pathImpl.sep === "\\"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
