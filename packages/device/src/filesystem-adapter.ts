import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import * as path from "node:path";
import type {
  DeviceAdapter,
  DeviceDescriptor,
  TransferItem,
  TransferPlan,
  TransferPlanItem,
  TransferResult,
} from "./models.js";
import { detectDeviceProfile } from "./profiles.js";

export class FilesystemDeviceAdapter implements DeviceAdapter {
  private readonly rootPath: string;

  constructor(mountOrFolderPath: string) {
    this.rootPath = path.resolve(mountOrFolderPath);
  }

  public async discover(): Promise<readonly DeviceDescriptor[]> {
    let stat;
    try {
      stat = await fs.stat(this.rootPath);
    } catch {
      return [];
    }

    if (!stat.isDirectory()) {
      return [];
    }

    const profile = await detectDeviceProfile(this.rootPath);
    let freeSpaceBytes: number | undefined;
    let totalSpaceBytes: number | undefined;

    try {
      const statfs = await fs.statfs(this.rootPath);
      freeSpaceBytes = Number(statfs.bavail) * Number(statfs.bsize);
      totalSpaceBytes = Number(statfs.blocks) * Number(statfs.bsize);
    } catch {
      // statfs may fail on certain virtual/network mounts
    }

    return [
      {
        id: `fs-${Buffer.from(this.rootPath).toString("base64url").slice(0, 16)}`,
        name: profile.name,
        type: "filesystem",
        mountPoint: this.rootPath,
        isAvailable: true,
        profile,
        freeSpaceBytes,
        totalSpaceBytes,
      },
    ];
  }

  public async createTransferPlan(
    items: readonly TransferItem[],
    targetDevice: DeviceDescriptor,
  ): Promise<TransferPlan> {
    const root = path.resolve(targetDevice.mountPoint);
    const booksDir = targetDevice.profile?.booksDirectory
      ? path.join(root, targetDevice.profile.booksDirectory)
      : root;

    const planItems: TransferPlanItem[] = [];
    let totalBytesToCopy = 0;
    let hasConflicts = false;

    for (const item of items) {
      if (
        item.targetFilename.includes("..") ||
        path.isAbsolute(item.targetFilename)
      ) {
        throw new Error(
          `Path traversal escape attempt detected in target filename: '${item.targetFilename}'.`,
        );
      }

      // Destination safety containment check
      const safeFilename = path.basename(item.targetFilename);
      const targetPath = path.join(booksDir, safeFilename);

      this.assertPathContained(targetPath, root);

      let status: TransferPlanItem["status"];
      let reason: string | undefined;

      try {
        const destStat = await fs.stat(targetPath);
        // Destination file exists: check if identical
        if (destStat.size === item.byteSize) {
          const sourceHash =
            item.sourceSha256 ?? (await computeFileHash(item.sourcePath));
          const destHash = await computeFileHash(targetPath);

          if (sourceHash === destHash) {
            status = "skip";
            reason = "Identical file already exists on device";
          } else {
            status = "conflict";
            reason = "File exists with same size but different content";
            hasConflicts = true;
          }
        } else {
          status = "conflict";
          reason = `File already exists with different size (${destStat.size} bytes vs ${item.byteSize} bytes)`;
          hasConflicts = true;
        }
      } catch {
        // Destination does not exist: clean copy
        status = "copy";
      }

      if (status === "copy") {
        totalBytesToCopy += item.byteSize;
      }

      planItems.push({
        sourcePath: item.sourcePath,
        targetPath,
        status,
        byteSize: item.byteSize,
        reason,
      });
    }

    const availableBytes = targetDevice.freeSpaceBytes;
    const insufficientSpace =
      availableBytes !== undefined && totalBytesToCopy > availableBytes;

    return {
      device: targetDevice,
      items: planItems,
      totalBytesToCopy,
      availableBytes,
      hasConflicts,
      insufficientSpace,
    };
  }

  public async executeTransfer(
    plan: TransferPlan,
    options: { signal?: AbortSignal } = {},
  ): Promise<TransferResult> {
    if (plan.insufficientSpace) {
      throw new Error(
        `Insufficient storage space on device '${plan.device.name}' (needed: ${plan.totalBytesToCopy} bytes, available: ${plan.availableBytes} bytes).`,
      );
    }

    let successful = 0;
    let skipped = 0;
    let failed = 0;
    const errors: { path: string; error: string }[] = [];

    for (const item of plan.items) {
      if (options.signal?.aborted) {
        throw new Error("Transfer aborted by user.");
      }

      if (item.status === "skip") {
        skipped++;
        continue;
      }

      if (item.status === "conflict") {
        skipped++;
        errors.push({
          path: item.targetPath,
          error:
            item.reason ??
            "Skipped due to existing conflicting file on device.",
        });
        continue;
      }

      // Execute verified copy
      const targetDir = path.dirname(item.targetPath);
      await fs.mkdir(targetDir, { recursive: true });

      const tempFile = path.join(
        targetDir,
        `.tmp-transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(item.targetPath)}`,
      );

      try {
        const sourceHash = await computeFileHash(item.sourcePath);

        const readStream = createReadStream(item.sourcePath);
        const writeStream = createWriteStream(tempFile);
        const destHashMeter = createHash("sha256");

        const hashTransform = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            destHashMeter.update(chunk);
            callback(null, chunk);
          },
        });

        await pipeline(readStream, hashTransform, writeStream);

        const destHash = destHashMeter.digest("hex");
        if (destHash !== sourceHash) {
          throw new Error(
            `SHA-256 verification failed (source: ${sourceHash}, written: ${destHash}).`,
          );
        }

        // Atomically rename into place
        await fs.rename(tempFile, item.targetPath);
        successful++;
      } catch (err) {
        failed++;
        errors.push({
          path: item.sourcePath,
          error: err instanceof Error ? err.message : String(err),
        });
        await fs.unlink(tempFile).catch(() => {});
      }
    }

    return {
      successful,
      skipped,
      failed,
      errors,
    };
  }

  private assertPathContained(targetPath: string, root: string): void {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(root);

    if (
      !resolvedTarget.startsWith(resolvedRoot) ||
      resolvedTarget === resolvedRoot
    ) {
      throw new Error(
        `Path traversal denied: target path '${resolvedTarget}' escapes device root '${resolvedRoot}'.`,
      );
    }
  }
}

export async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
