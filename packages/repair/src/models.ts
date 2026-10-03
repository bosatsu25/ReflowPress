import type { HealthReport } from "@reflowpress/quality";

export type RepairRisk = "safe" | "review" | "manual";

export type RepairActionType =
  "canonical-mimetype" | "container-xml" | "manifest-mediatype";

export interface RepairAction {
  readonly id: string;
  readonly ruleId: string;
  readonly type: RepairActionType;
  readonly title: string;
  readonly description: string;
  readonly risk: RepairRisk;
  readonly targetFile: string;
  readonly beforeSnippet?: string | undefined;
  readonly afterSnippet?: string | undefined;
}

export interface RepairPlan {
  readonly publicationPath: string;
  readonly actions: readonly RepairAction[];
  readonly safeActionCount: number;
  readonly reviewActionCount: number;
  readonly manualActionCount: number;
}

export interface RepairFileDiff {
  readonly file: string;
  readonly before: string;
  readonly after: string;
}

export interface RepairPreview {
  readonly publicationPath: string;
  readonly plannedActions: readonly RepairAction[];
  readonly diffs: readonly RepairFileDiff[];
}

export interface RepairResult {
  readonly success: boolean;
  readonly sourcePath: string;
  readonly outputPath?: string | undefined;
  readonly actionsApplied: readonly string[];
  readonly preHealthReport: HealthReport;
  readonly postHealthReport?: HealthReport | undefined;
  readonly error?: string | undefined;
}

export interface RepairProvenance {
  readonly toolVersion: string;
  readonly timestamp: string;
  readonly sourceSha256: string;
  readonly outputSha256: string;
  readonly appliedRuleIds: readonly string[];
}
