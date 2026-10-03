import { readFile, open, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AnnotationRepository,
  AnnotationStore,
  PublicationIdentity,
  ImportReport,
} from "@reflowpress/annotations";
import {
  createDefaultAnnotationStore,
  exportAnnotationsToJson,
  exportAnnotationsToMarkdown,
  exportAnnotationsToHtml,
  importAnnotationsFromJson,
} from "@reflowpress/annotations";

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

      if (parsed.schemaVersion && parsed.schemaVersion > 1) {
        throw new Error(
          `Unsupported annotation schema version: ${parsed.schemaVersion}. Please upgrade ReflowPress.`,
        );
      }

      if (!Array.isArray(parsed.annotations)) {
        throw new Error("Malformed annotations field: expected array");
      }

      return {
        schemaVersion: parsed.schemaVersion ?? 1,
        annotations: parsed.annotations,
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error && error.code === "ENOENT") {
        return createDefaultAnnotationStore();
      }

      // Check if schema version is too new: do not overwrite!
      if (
        error instanceof Error &&
        error.message.includes("Unsupported annotation schema version")
      ) {
        throw error;
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
    return (this.writeQueue = this.writeQueue.then(async () => {
      const dir = path.dirname(this.filePath);
      await mkdir(dir, { recursive: true });

      const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
      const payload = JSON.stringify(store, null, 2);

      // Write to temp file and fsync
      const handle = await open(tempPath, "w");
      try {
        await handle.writeFile(payload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Atomic rename
      await rename(tempPath, this.filePath);
    }));
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

    const dir = path.dirname(targetFilePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${targetFilePath}.tmp.${process.pid}.${Date.now()}`;
    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(tempPath, targetFilePath);
  }

  async importFromFile(
    sourceFilePath: string,
    targetPublicationId: string,
  ): Promise<ImportReport> {
    const rawJson = await readFile(sourceFilePath, "utf8");
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
