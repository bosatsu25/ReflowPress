import { readFile, open, rename, mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { UpgradeRequiredError } from "@reflowpress/core";
import type {
  AnnotationRepository,
  AnnotationStore,
  PublicationIdentity,
  ImportReport,
} from "@reflowpress/annotations";
import {
  createDefaultAnnotationStore,
  createEmptyImportReport,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  exportAnnotationsToHtml,
  importAnnotationsFromJson,
  MAX_ANNOTATION_IMPORT_BYTES,
} from "@reflowpress/annotations";

/**
 * Atomically writes `content` to `targetPath` via a uniquely named temp file
 * (fsync + rename). The temp file is removed if any step fails.
 */
async function writeFileAtomic(
  targetPath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${randomUUID()}`;
  let created = false;
  try {
    // "wx": never follow or clobber an existing path
    const handle = await open(tempPath, "wx");
    created = true;
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Atomic rename
    await rename(tempPath, targetPath);
  } catch (error) {
    if (created) {
      await unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Reads a UTF-8 text file only if it is a regular file no larger than
 * `maxBytes`; the size is checked before (fstat) and while reading, so an
 * oversized or growing file is never fully buffered.
 */
async function readBoundedTextFile(
  filePath: string,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { ok: false, reason: "Import source is not a regular file" };
    }
    if (info.size > maxBytes) {
      return {
        ok: false,
        reason: "Import file exceeds maximum size limit (5MB)",
      };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        return {
          ok: false,
          reason: "Import file exceeds maximum size limit (5MB)",
        };
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { ok: true, text: Buffer.concat(chunks, total).toString("utf8") };
  } finally {
    await handle.close();
  }
}

export class JsonAnnotationRepository implements AnnotationRepository {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<AnnotationStore> {
    try {
      const data = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(data) as Partial<AnnotationStore>;

      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Invalid annotation store JSON structure");
      }

      const schemaVersion =
        typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;

      if (schemaVersion > 1) {
        throw new UpgradeRequiredError("annotation", 1, schemaVersion);
      }

      if (!Array.isArray(parsed.annotations)) {
        throw new Error("Malformed annotations field: expected array");
      }

      return {
        schemaVersion,
        annotations: parsed.annotations,
      };
    } catch (err: unknown) {
      if (err instanceof UpgradeRequiredError) {
        throw err;
      }

      const error = err as NodeJS.ErrnoException;
      if (error && error.code === "ENOENT") {
        return createDefaultAnnotationStore();
      }

      // File is corrupt: quarantine it
      console.warn(
        `[ReflowPress Annotations] Corrupt annotation store detected at ${this.filePath}. Quarantining and starting fresh.`,
        err,
      );

      const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await rename(this.filePath, quarantinePath);
        console.warn(
          `[ReflowPress Annotations] Quarantined corrupted annotations to ${quarantinePath}`,
        );
      } catch (renameErr) {
        console.error(
          `[ReflowPress Annotations] Failed to quarantine corrupt file:`,
          renameErr,
        );
      }

      return createDefaultAnnotationStore();
    }
  }

  async save(store: AnnotationStore): Promise<void> {
    const task = this.writeQueue.then(() =>
      writeFileAtomic(this.filePath, JSON.stringify(store, null, 2)),
    );
    // A failed save must not poison every later save in the queue.
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  async exportToFile(
    publication: PublicationIdentity,
    format: "json" | "markdown" | "html",
    targetFilePath: string,
    publicationId?: string | undefined,
  ): Promise<void> {
    const store = await this.load();
    let content: string;

    if (format === "json") {
      content = exportAnnotationsToJson(store, publication, publicationId);
    } else if (format === "markdown") {
      content = exportAnnotationsToMarkdown(store, publication, publicationId);
    } else {
      content = exportAnnotationsToHtml(store, publication, publicationId);
    }

    await writeFileAtomic(targetFilePath, content);
  }

  async importFromFile(
    sourceFilePath: string,
    targetPublicationId: string,
  ): Promise<ImportReport> {
    // Check the size before buffering the file (5 MB limit)
    const source = await readBoundedTextFile(
      sourceFilePath,
      MAX_ANNOTATION_IMPORT_BYTES,
    );
    if (!source.ok) {
      const report = createEmptyImportReport();
      report.errors.push(source.reason);
      return report;
    }
    const rawJson = source.text;
    const existingStore = await this.load();

    const { store: updatedStore, report } = importAnnotationsFromJson(
      rawJson,
      targetPublicationId,
      existingStore,
    );

    if (report.imported > 0 || report.conflictsResolved > 0) {
      await this.save(updatedStore);
    }

    return report;
  }
}
