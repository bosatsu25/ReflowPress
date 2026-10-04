export interface ChecksumItem {
  readonly file: string;
  readonly hash: string;
}

export interface ChecksumResult {
  readonly count: number;
  readonly checksums: readonly ChecksumItem[];
  readonly outputPath: string | null;
}

export function computeFileSha256(filePath: string): string;
export function generateChecksums(targetDir?: string): ChecksumResult;
