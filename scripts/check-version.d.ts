export interface VersionMismatch {
  readonly file: string;
  readonly name: string;
  readonly found: string;
  readonly expected: string;
}

export interface VersionCheckResult {
  readonly canonicalVersion: string;
  readonly checkedCount: number;
  readonly mismatches: readonly VersionMismatch[];
}

export function checkVersionConsistency(): VersionCheckResult;
