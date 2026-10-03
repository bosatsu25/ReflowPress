import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectDeviceProfile,
  FilesystemDeviceAdapter,
  MtpDeviceAdapter,
  type TransferItem,
} from "../../packages/device/src/index.js";

describe("E-Reader Device Transfer (@reflowpress/device)", () => {
  let tempMount: string;

  beforeEach(async () => {
    tempMount = await fs.mkdtemp(
      path.join(os.tmpdir(), "reflowpress-device-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempMount, { recursive: true, force: true }).catch(() => {});
  });

  describe("detectDeviceProfile", () => {
    it("detects Kindle profile when documents/ directory exists", async () => {
      await fs.mkdir(path.join(tempMount, "documents"), { recursive: true });
      const profile = await detectDeviceProfile(tempMount);
      expect(profile.id).toBe("kindle");
      expect(profile.booksDirectory).toBe("documents");
      expect(profile.supportedFormats).toContain("pdf");
    });

    it("detects Kobo profile when .kobo/ directory exists", async () => {
      await fs.mkdir(path.join(tempMount, ".kobo"), { recursive: true });
      const profile = await detectDeviceProfile(tempMount);
      expect(profile.id).toBe("kobo");
      expect(profile.supportedFormats).toContain("epub");
      expect(profile.supportedFormats).toContain("kepub");
    });

    it("falls back to generic profile when no vendor markers exist", async () => {
      const profile = await detectDeviceProfile(tempMount);
      expect(profile.id).toBe("generic");
      expect(profile.booksDirectory).toBe("");
    });
  });

  describe("FilesystemDeviceAdapter", () => {
    it("discovers device and returns valid descriptor", async () => {
      const adapter = new FilesystemDeviceAdapter(tempMount);
      const devices = await adapter.discover();
      expect(devices).toHaveLength(1);
      const dev = devices[0]!;
      expect(dev.type).toBe("filesystem");
      expect(dev.mountPoint).toBe(path.resolve(tempMount));
      expect(dev.isAvailable).toBe(true);
    });

    it("prevents path traversal outside target mount root", async () => {
      const adapter = new FilesystemDeviceAdapter(tempMount);
      const devices = await adapter.discover();
      const dev = devices[0]!;

      const maliciousItem: TransferItem = {
        sourcePath: path.join(tempMount, "source.epub"),
        targetFilename: "../../system-escape.epub",
        format: "epub",
        byteSize: 100,
      };

      await expect(
        adapter.createTransferPlan([maliciousItem], dev),
      ).rejects.toThrow(/Path traversal escape attempt/);
    });

    it("transfers files safely with SHA-256 integrity and skips identical files", async () => {
      const sourceFile = path.join(tempMount, "sample.epub");
      const content = "EPUB Content for testing device transfer";
      await fs.writeFile(sourceFile, content, "utf-8");

      const adapter = new FilesystemDeviceAdapter(tempMount);
      const devices = await adapter.discover();
      const dev = devices[0]!;

      const item: TransferItem = {
        sourcePath: sourceFile,
        targetFilename: "book.epub",
        format: "epub",
        byteSize: Buffer.byteLength(content),
      };

      // 1. Initial transfer
      const plan1 = await adapter.createTransferPlan([item], dev);
      expect(plan1.items[0]?.status).toBe("copy");

      const res1 = await adapter.executeTransfer(plan1);
      expect(res1.successful).toBe(1);
      expect(res1.skipped).toBe(0);
      expect(res1.failed).toBe(0);

      const targetPath = plan1.items[0]!.targetPath;
      const targetContent = await fs.readFile(targetPath, "utf-8");
      expect(targetContent).toBe(content);

      // 2. Second transfer of identical file -> should skip
      const plan2 = await adapter.createTransferPlan([item], dev);
      expect(plan2.items[0]?.status).toBe("skip");
      expect(plan2.items[0]?.reason).toContain("Identical file already exists");

      const res2 = await adapter.executeTransfer(plan2);
      expect(res2.successful).toBe(0);
      expect(res2.skipped).toBe(1);
      expect(res2.failed).toBe(0);
    });

    it("marks different content with same name as conflict without silent overwrite", async () => {
      const adapter = new FilesystemDeviceAdapter(tempMount);
      const devices = await adapter.discover();
      const dev = devices[0]!;

      // Create an existing file on the device
      const existingFile = path.join(tempMount, "existing.epub");
      await fs.writeFile(existingFile, "Original content on device", "utf-8");

      // Source has different content
      const sourceFile = path.join(tempMount, "source_modified.epub");
      await fs.writeFile(
        sourceFile,
        "Modified different content in library",
        "utf-8",
      );

      const item: TransferItem = {
        sourcePath: sourceFile,
        targetFilename: "existing.epub",
        format: "epub",
        byteSize: (await fs.stat(sourceFile)).size,
      };

      const plan = await adapter.createTransferPlan([item], dev);
      expect(plan.hasConflicts).toBe(true);
      expect(plan.items[0]?.status).toBe("conflict");

      const res = await adapter.executeTransfer(plan);
      expect(res.successful).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.errors).toHaveLength(1);
      // Original content on device should remain untouched
      expect(await fs.readFile(existingFile, "utf-8")).toBe(
        "Original content on device",
      );
    });
  });

  describe("MtpDeviceAdapter (Technical Spike Boundary)", () => {
    it("reports deferred status and helpful user guidance", async () => {
      const mtp = new MtpDeviceAdapter();
      const devices = await mtp.discover();
      expect(devices).toHaveLength(0);

      await expect(
        mtp.createTransferPlan([], {
          id: "mtp-dummy",
          name: "MTP Device",
          type: "mtp",
          mountPoint: "",
          isAvailable: false,
        }),
      ).rejects.toThrow(/Direct MTP wire protocol is deferred/);
    });
  });
});
