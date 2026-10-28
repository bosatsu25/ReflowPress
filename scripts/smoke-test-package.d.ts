export interface PackageVerificationResult {
  readonly valid: boolean;
  readonly platform: string;
  readonly unpackedDir: string;
  readonly binaryPath: string;
  readonly binarySize: number;
  readonly runtimePath: string;
  readonly runtimeSize: number;
  readonly asarPath: string;
  readonly installers: readonly string[];
}

export interface PlatformArtifactsResult {
  readonly valid: boolean;
  readonly platform: string;
  readonly artifacts: readonly string[];
}

export function verifyPackagedArtifacts(
  targetDir?: string,
  platform?: string,
): PackageVerificationResult;
export function assertPlatformArtifacts(
  targetDir?: string,
  platform?: string,
): PlatformArtifactsResult;
