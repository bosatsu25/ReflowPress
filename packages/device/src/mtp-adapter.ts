import type {
  DeviceAdapter,
  DeviceDescriptor,
  TransferItem,
  TransferPlan,
  TransferResult,
} from "./models.js";

/**
 * MtpDeviceAdapter: Capability Boundary & Spike Evaluation
 *
 * Spike Evaluation Summary (Milestone 0.9):
 * 1. Windows Portable Devices (WPD): Requires native COM/C++ addon, complex STA/MTA threading, not cross-platform.
 * 2. libmtp: Unmaintained Node.js bindings; requires WinUSB filter driver replacements on Windows that break Explorer MTP.
 * 3. Distribution & Licensing: Native addons complicate precompiled binary distribution across Windows/macOS/Linux x64/arm64 and introduce GPL license entanglements.
 *
 * Decision:
 * In adherence to ReflowPress architecture and safety guidelines, native MTP wire protocol
 * is NOT implemented from scratch. This adapter cleanly reports MTP capability as unavailable/deferred,
 * guiding users to use USB Mass Storage mode or mount the device to a local folder.
 */
export class MtpDeviceAdapter implements DeviceAdapter {
  public static readonly IS_AVAILABLE = false;
  public static readonly DEFERRAL_REASON =
    "Direct MTP wire protocol is deferred pending stable, safely distributable cross-platform Node.js bindings. Please connect your e-reader using USB Mass Storage mode or mount the device directory.";

  public async discover(): Promise<readonly DeviceDescriptor[]> {
    return [];
  }

  public async createTransferPlan(
    items: readonly TransferItem[],
    targetDevice: DeviceDescriptor,
  ): Promise<TransferPlan> {
    void items;
    void targetDevice;
    throw new Error(
      `MTP transfer is currently unavailable: ${MtpDeviceAdapter.DEFERRAL_REASON}`,
    );
  }

  public async executeTransfer(
    plan: TransferPlan,
    options?: { signal?: AbortSignal },
  ): Promise<TransferResult> {
    void plan;
    void options;
    throw new Error(
      `MTP transfer is currently unavailable: ${MtpDeviceAdapter.DEFERRAL_REASON}`,
    );
  }
}
