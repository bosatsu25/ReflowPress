/**
 * E-reader Device and Transfer Models
 */

export interface DeviceProfile {
  readonly id: "kindle" | "kobo" | "pocketbook" | "generic";
  readonly name: string;
  readonly booksDirectory: string;
  readonly supportedFormats: readonly ("epub" | "pdf" | "kepub")[];
}

export interface DeviceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly type: "filesystem" | "mtp";
  readonly mountPoint: string;
  readonly isAvailable: boolean;
  readonly profile?: DeviceProfile | undefined;
  readonly freeSpaceBytes?: number | undefined;
  readonly totalSpaceBytes?: number | undefined;
}

export interface TransferItem {
  readonly sourcePath: string;
  readonly targetFilename: string;
  readonly format: "epub" | "pdf";
  readonly byteSize: number;
  readonly sourceSha256?: string | undefined;
}

export interface TransferPlanItem {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly status: "copy" | "skip" | "conflict";
  readonly byteSize: number;
  readonly reason?: string | undefined;
}

export interface TransferPlan {
  readonly device: DeviceDescriptor;
  readonly items: readonly TransferPlanItem[];
  readonly totalBytesToCopy: number;
  readonly availableBytes?: number | undefined;
  readonly hasConflicts: boolean;
  readonly insufficientSpace: boolean;
}

export interface TransferResult {
  readonly successful: number;
  readonly skipped: number;
  readonly failed: number;
  readonly errors: readonly {
    readonly path: string;
    readonly error: string;
  }[];
}

export interface DeviceAdapter {
  discover(): Promise<readonly DeviceDescriptor[]>;
  createTransferPlan(
    items: readonly TransferItem[],
    targetDevice: DeviceDescriptor,
  ): Promise<TransferPlan>;
  executeTransfer(
    plan: TransferPlan,
    options?: { signal?: AbortSignal },
  ): Promise<TransferResult>;
}
