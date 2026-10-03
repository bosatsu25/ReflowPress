import path from "node:path";
import { ExportError } from "./models.js";

export interface FilenameOptions {
  readonly sourcePath: string;
  readonly format: "pdf" | "html" | "markdown";
  readonly clock?: (() => Date) | undefined;
  readonly isCollision?:
    ((candidate: string) => boolean | Promise<boolean>) | undefined;
  readonly overwrite?: boolean | undefined;
}

export interface GeneratedFilename {
  readonly filename: string;
  readonly assetDirectoryName?: string | undefined;
}

/**
 * Sanitizes a filename stem to remove filesystem-illegal characters
 * while strictly preserving Unicode (Japanese, Cyrillic, etc.) text.
 */
export function sanitizeStem(stem: string): string {
  // Remove control characters (0-31 and 127) and Windows reserved chars: < > : " / \ | ? *
  // eslint-disable-next-line no-control-regex
  let sanitized = stem.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_");
  // Trim spaces and dots from ends (forbidden on Windows)
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, "");
  if (!sanitized || /^_+$/.test(sanitized)) {
    return "publication";
  }
  return sanitized;
}

/**
 * Formats a Date object into a deterministic YYYYMMDD-HHmmss timestamp.
 */
export function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

/**
 * Generates a deterministic, collision-safe filename according to ReflowPress naming policy:
 * `<source-basename>_<YYYYMMDD-HHmmss>.<ext>`
 * Collision resolution: appends `-001`, `-002`, ..., up to `-999`.
 */
export async function generateDeterministicFilename(
  options: FilenameOptions,
): Promise<GeneratedFilename> {
  const rawBase = path.basename(options.sourcePath);
  const extIndex = rawBase.lastIndexOf(".");
  const rawStem = extIndex > 0 ? rawBase.slice(0, extIndex) : rawBase;
  const safeStem = sanitizeStem(rawStem);

  const date = options.clock ? options.clock() : new Date();
  const timestamp = formatTimestamp(date);

  const ext =
    options.format === "pdf"
      ? ".pdf"
      : options.format === "html"
        ? ".html"
        : ".md";
  const baseNameWithoutExt = `${safeStem}_${timestamp}`;

  const isCollisionFn = options.isCollision;
  const overwrite = options.overwrite ?? false;

  let chosenBase = baseNameWithoutExt;
  let chosenFilename = `${chosenBase}${ext}`;

  if (isCollisionFn && !overwrite) {
    const primaryExists = await isCollisionFn(chosenFilename);
    if (primaryExists) {
      let resolved = false;
      for (let i = 1; i <= 999; i += 1) {
        const suffix = `-${String(i).padStart(3, "0")}`;
        const candidateBase = `${baseNameWithoutExt}${suffix}`;
        const candidateFilename = `${candidateBase}${ext}`;
        const exists = await isCollisionFn(candidateFilename);
        if (!exists) {
          chosenBase = candidateBase;
          chosenFilename = candidateFilename;
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        throw new ExportError(
          "OUTPUT_COLLISION_FAILED",
          `Unable to resolve unique output filename for '${chosenFilename}': exceeded 999 collision attempts.`,
        );
      }
    }
  }

  const assetDirectoryName =
    options.format === "markdown" ? `${chosenBase}_assets` : undefined;

  return {
    filename: chosenFilename,
    assetDirectoryName,
  };
}
