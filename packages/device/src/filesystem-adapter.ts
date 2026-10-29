import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
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
    const root = await realDeviceRoot(targetDevice.mountPoint);
    const booksDir = await resolveBooksDirectory(
      root,
      targetDevice.profile?.booksDirectory ?? "",
    );

    const planItems: TransferPlanItem[] = [];
    let totalBytesToCopy = 0;
    let hasConflicts = false;

    for (const item of items) {
      assertSafeFilename(item.targetFilename);
      const targetPath = path.join(booksDir, item.targetFilename);
      assertWithin(targetPath, root);

      let status: TransferPlanItem["status"];
      let reason: string | undefined;

      try {
        // lstat: a symlink planted on the device is never followed.
        const destStat = await fs.lstat(targetPath);
        if (!destStat.isFile()) {
          status = "conflict";
          reason = "A non-regular file (link or folder) has this name";
          hasConflicts = true;
        } else if (destStat.size === item.byteSize) {
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
    const root = await realDeviceRoot(plan.device.mountPoint);

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
      const tempFile = path.join(targetDir, `.tmp-transfer-${randomUUID()}`);
      let tempCreated = false;

      try {
        // The plan is re-checked here: the device can change between
        // planning and copying, and a plan may come from elsewhere.
        assertSafeFilename(path.basename(item.targetPath));
        assertWithin(item.targetPath, root);
        await fs.mkdir(targetDir, { recursive: true });
        assertWithin(path.join(await fs.realpath(targetDir), "x"), root);

        const sourceHash = await computeFileHash(item.sourcePath);

        const readStream = createReadStream(item.sourcePath);
        const writeStream = createWriteStream(tempFile, { flags: "wx" });
        tempCreated = true;
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

        await commitWithoutOverwrite(tempFile, item.targetPath);
        successful++;
      } catch (err) {
        failed++;
        errors.push({
          path: item.sourcePath,
          error: err instanceof Error ? err.message : String(err),
        });
        if (tempCreated) await fs.unlink(tempFile).catch(() => {});
      }
    }

    return {
      successful,
      skipped,
      failed,
      errors,
    };
  }
}

async function realDeviceRoot(mountPoint: string): Promise<string> {
  return fs.realpath(path.resolve(mountPoint));
}

/**
 * Resolves the profile's books folder on the device, following any link only
 * if it stays on the device.
 */
async function resolveBooksDirectory(
  root: string,
  booksDirectory: string,
): Promise<string> {
  const booksDir = path.join(root, booksDirectory);
  if (booksDir === root) return root;
  try {
    const real = await fs.realpath(booksDir);
    assertWithin(path.join(real, "x"), root);
    return real;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return booksDir;
    throw err;
  }
}

/** A single path segment: no separators, no dot segments, no control characters. */
function assertSafeFilename(name: string): void {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    /[/\\]/.test(name) ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f]/.test(name) ||
    path.isAbsolute(name)
  ) {
    throw new Error(
      `Path traversal escape attempt detected in target filename: '${name}'.`,
    );
  }
}

function assertWithin(target: string, root: string): void {
  const relative = path.relative(root, path.resolve(target));
  if (
    relative === "" ||
    path.isAbsolute(relative) ||
    relative.split(path.sep)[0] === ".."
  ) {
    throw new Error(
      `Path traversal denied: target path '${target}' escapes device root '${root}'.`,
    );
  }
}

/**
 * Moves the verified temp file into place without replacing a file that
 * appeared after planning. A hard link is atomic and fails if the name is
 * taken; FAT and exFAT, the usual e-reader filesystems, have no hard links,
 * so those fall back to a check immediately before the rename.
 */
async function commitWithoutOverwrite(
  tempFile: string,
  targetPath: string,
): Promise<void> {
  const appeared = (cause?: unknown) =>
    new Error(
      "A file with this name appeared on the device during the transfer; it was left untouched.",
      { cause },
    );

  let linked = false;
  try {
    await fs.link(tempFile, targetPath);
    linked = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw appeared(err);
    // Any other failure means no hard links here (EPERM on Linux vfat,
    // ENOTSUP on macOS, EISDIR from libuv on Windows FAT).
  }
  if (linked) {
    await fs.unlink(tempFile);
    return;
  }

  try {
    await fs.lstat(targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.rename(tempFile, targetPath);
      return;
    }
    throw err;
  }
  throw appeared();
}

export async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
