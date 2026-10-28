import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { UpgradeRequiredError } from "@reflowpress/core";
import type { SavedReadingPosition } from "@reflowpress/reader";

interface ReaderStateFile {
  readonly version: 1;
  readonly positions: Record<string, SavedReadingPosition>;
}

export class ReadingPositionStore {
  private readonly filePath: string;
  private memoryCache: Map<string, SavedReadingPosition> = new Map();
  private initialized = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      const data = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(data) as Partial<ReaderStateFile>;

      if (parsed && typeof parsed.version === "number" && parsed.version > 1) {
        throw new UpgradeRequiredError(
          "Reading Position Store",
          1,
          parsed.version,
        );
      }

      if (parsed && parsed.version === 1 && parsed.positions) {
        for (const [key, value] of Object.entries(parsed.positions)) {
          this.memoryCache.set(key, value);
        }
      }
    } catch (err: unknown) {
      if (err instanceof UpgradeRequiredError) {
        throw err;
      }
      // Missing or malformed file: gracefully start with empty cache
      this.memoryCache.clear();
    }
    this.initialized = true;
  }

  async getPosition(
    publicationId: string,
  ): Promise<SavedReadingPosition | null> {
    await this.ensureInitialized();
    return this.memoryCache.get(publicationId) ?? null;
  }

  async savePosition(position: SavedReadingPosition): Promise<void> {
    await this.ensureInitialized();
    this.memoryCache.set(position.publicationId, position);

    const positionsObj: Record<string, SavedReadingPosition> = {};
    for (const [k, v] of this.memoryCache.entries()) {
      positionsObj[k] = v;
    }

    const payload: ReaderStateFile = {
      version: 1,
      positions: positionsObj,
    };

    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    // Atomic write via temp file
    const tempPath = `${this.filePath}.tmp-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}
