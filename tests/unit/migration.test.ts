import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MigrationRunner,
  UpgradeRequiredError,
  CorruptDataError,
} from "../../packages/core/src/index.js";
import { JsonLibraryRepository } from "../../apps/desktop/src/main/library-repository.js";
import { JsonAnnotationRepository } from "../../apps/desktop/src/main/annotation-repository.js";
import { ReadingPositionStore } from "../../apps/desktop/src/main/reading-position-store.js";
import { deserializeSyncBundle } from "../../packages/sync/src/bundle.js";

describe("Persistence Migration Framework & Future Schema Safety", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reflowpress-migration-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("MigrationRunner", () => {
    interface V3Doc {
      schemaVersion: 3;
      title: string;
      tags: string[];
    }

    const runner = new MigrationRunner<V3Doc>({
      entityName: "TestDoc",
      currentVersion: 3,
      validate: (doc: unknown): doc is V3Doc => {
        const d = doc as Partial<V3Doc>;
        return (
          typeof d === "object" &&
          d !== null &&
          d.schemaVersion === 3 &&
          typeof d.title === "string" &&
          Array.isArray(d.tags)
        );
      },
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate: (data: unknown) => {
            const raw = data as { version: 1; name: string };
            return {
              schemaVersion: 2,
              title: raw.name,
            };
          },
        },
        {
          fromVersion: 2,
          toVersion: 3,
          migrate: (data: unknown) => {
            const raw = data as { schemaVersion: 2; title: string };
            return {
              schemaVersion: 3,
              title: raw.title,
              tags: [],
            };
          },
        },
      ],
    });

    it("migrates sequentially across multiple schema versions", () => {
      const v1 = { version: 1, name: "Legacy Book" };
      const migrated = runner.run(v1);
      expect(migrated).toEqual({
        schemaVersion: 3,
        title: "Legacy Book",
        tags: [],
      });
    });

    it("accepts document already at current version", () => {
      const v3: V3Doc = { schemaVersion: 3, title: "Modern Book", tags: ["fiction"] };
      const result = runner.run(v3);
      expect(result).toEqual(v3);
    });

    it("throws UpgradeRequiredError when document is from future schema version", () => {
      const futureDoc = { schemaVersion: 99, title: "Future Book" };
      expect(() => runner.run(futureDoc)).toThrow(UpgradeRequiredError);
      try {
        runner.run(futureDoc);
      } catch (err) {
        expect(err).toBeInstanceOf(UpgradeRequiredError);
        const upgradeErr = err as UpgradeRequiredError;
        expect(upgradeErr.entityName).toBe("TestDoc");
        expect(upgradeErr.currentVersion).toBe(3);
        expect(upgradeErr.incomingVersion).toBe(99);
      }
    });

    it("throws CorruptDataError if a required migration step is missing", () => {
      const incompleteRunner = new MigrationRunner<V3Doc>({
        entityName: "IncompleteDoc",
        currentVersion: 3,
        validate: (_d: unknown): _d is V3Doc => typeof _d === "object" && _d !== null,
        migrations: [],
      });
      expect(() => incompleteRunner.run({ schemaVersion: 1 })).toThrow(CorruptDataError);
    });

    it("throws CorruptDataError if raw input is not an object", () => {
      expect(() => runner.run(null)).toThrow(CorruptDataError);
      expect(() => runner.run("invalid")).toThrow(CorruptDataError);
    });
  });

  describe("JsonLibraryRepository Schema Safety", () => {
    it("refuses to overwrite or quarantine future library catalog versions", async () => {
      const catalogPath = path.join(tempDir, "catalog.json");
      const futurePayload = {
        schemaVersion: 42,
        books: [{ id: "b1", title: "Future Book" }],
        collections: [],
      };
      await fs.writeFile(catalogPath, JSON.stringify(futurePayload), "utf8");

      const repo = new JsonLibraryRepository(catalogPath);
      await expect(repo.load()).rejects.toThrow(UpgradeRequiredError);

      // Verify the file was NOT deleted or renamed
      const content = await fs.readFile(catalogPath, "utf8");
      expect(JSON.parse(content)).toEqual(futurePayload);

      // Verify NO quarantine file was created
      const files = await fs.readdir(tempDir);
      const corruptFiles = files.filter((f) => f.includes("corrupt"));
      expect(corruptFiles.length).toBe(0);
    });

    it("quarantines genuinely corrupt catalog syntax", async () => {
      const catalogPath = path.join(tempDir, "catalog.json");
      await fs.writeFile(catalogPath, "{ malformed json", "utf8");

      const repo = new JsonLibraryRepository(catalogPath);
      const catalog = await repo.load();
      expect(catalog.books).toEqual([]);

      // Verify a quarantine file was created
      const files = await fs.readdir(tempDir);
      const corruptFiles = files.filter((f) => f.includes("corrupt"));
      expect(corruptFiles.length).toBe(1);
    });
  });

  describe("JsonAnnotationRepository Schema Safety", () => {
    it("refuses to overwrite or quarantine future annotation schema versions", async () => {
      const annPath = path.join(tempDir, "annotations.json");
      const futurePayload = {
        schemaVersion: 99,
        annotations: [{ id: "a1", text: "Important note" }],
      };
      await fs.writeFile(annPath, JSON.stringify(futurePayload), "utf8");

      const repo = new JsonAnnotationRepository(annPath);
      await expect(repo.load()).rejects.toThrow(UpgradeRequiredError);

      // Verify file was NOT modified or moved
      const content = await fs.readFile(annPath, "utf8");
      expect(JSON.parse(content)).toEqual(futurePayload);

      const files = await fs.readdir(tempDir);
      const corruptFiles = files.filter((f) => f.includes("corrupt"));
      expect(corruptFiles.length).toBe(0);
    });
  });

  describe("ReadingPositionStore Schema Safety", () => {
    it("throws UpgradeRequiredError when reader state is from future version", async () => {
      const statePath = path.join(tempDir, "reader-state.json");
      const futurePayload = {
        version: 99,
        positions: {
          "pub-1": {
            publicationId: "pub-1",
            sectionId: "sec-1",
            sectionIndex: 0,
            progress: 0.5,
            updatedAt: new Date().toISOString(),
          },
        },
      };
      await fs.writeFile(statePath, JSON.stringify(futurePayload), "utf8");

      const store = new ReadingPositionStore(statePath);
      await expect(store.getPosition("pub-1")).rejects.toThrow(UpgradeRequiredError);

      // Verify original file was untouched
      const content = await fs.readFile(statePath, "utf8");
      expect(JSON.parse(content)).toEqual(futurePayload);
    });
  });

  describe("Sync Bundle Schema Safety", () => {
    it("throws UpgradeRequiredError when sync bundle manifest is from a future version", () => {
      const bundle = {
        "manifest.json": JSON.stringify({
          schemaVersion: 999,
          generatedAt: new Date().toISOString(),
          deviceId: "remote-device",
          clientVersion: "99.0.0",
        }),
      };

      expect(() => deserializeSyncBundle(bundle)).toThrow(UpgradeRequiredError);
    });
  });
});
