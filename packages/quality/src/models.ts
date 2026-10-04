import type { PublicationMediaOverlaysReport } from "@reflowpress/epub";
export type { PublicationMediaOverlaysReport };

export type Severity = "info" | "warning" | "error" | "fatal";

export type Repairability = "none" | "manual" | "safe-auto" | "review-required";

export type QualityCategory =
  | "container"
  | "package"
  | "manifest"
  | "resource"
  | "navigation"
  | "reading-order"
  | "metadata"
  | "security"
  | "pdf-structure"
  | "pdf-text"
  | "pdf-geometry"
  | "pdf-image"
  | "pdf-font";

export interface QualityEvidence {
  readonly key: string;
  readonly value: string | number | boolean;
  readonly context?: string | undefined;
}

export interface QualityFindingLocation {
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly selector?: string | undefined;
}

export interface QualityFinding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly category: QualityCategory;
  readonly message: string;
  readonly location?: QualityFindingLocation | undefined;
  readonly evidence?: readonly QualityEvidence[] | undefined;
  readonly repairability: Repairability;
}

export interface HealthReportSummary {
  readonly totalFindings: number;
  readonly fatalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly safeRepairableCount: number;
  readonly reviewRequiredCount: number;
  readonly manualCount: number;
}

export interface HealthReport {
  readonly publicationPath: string;
  readonly publicationType: "epub" | "pdf";
  readonly inspectedAt: string;
  readonly durationMs: number;
  readonly findings: readonly QualityFinding[];
  readonly summary: HealthReportSummary;
  readonly rulesExecuted: readonly string[];
  readonly rulesSkipped: readonly string[];
  readonly toolVersion: string;
  readonly mediaOverlays?: PublicationMediaOverlaysReport | undefined;
}

export interface RuleDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: QualityCategory;
  readonly defaultSeverity: Severity;
  readonly defaultRepairability: Repairability;
  readonly description: string;
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  fatal: 4,
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * Deterministically sorts findings:
 * 1. Severity (fatal -> error -> warning -> info)
 * 2. Rule ID (alphabetical)
 * 3. File path (alphabetical)
 * 4. Line / Column (ascending)
 */
export function sortFindings(
  findings: readonly QualityFinding[],
): QualityFinding[] {
  return [...findings].sort((a, b) => {
    const diffSev = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (diffSev !== 0) return diffSev;

    const diffRule = a.ruleId.localeCompare(b.ruleId);
    if (diffRule !== 0) return diffRule;

    const pathA = a.location?.path ?? "";
    const pathB = b.location?.path ?? "";
    const diffPath = pathA.localeCompare(pathB);
    if (diffPath !== 0) return diffPath;

    const lineA = a.location?.line ?? 0;
    const lineB = b.location?.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;

    return a.message.localeCompare(b.message);
  });
}

/**
 * Deduplicates findings based on ruleId + location + message signature.
 */
export function deduplicateFindings(
  findings: readonly QualityFinding[],
): QualityFinding[] {
  const seen = new Set<string>();
  const deduplicated: QualityFinding[] = [];

  for (const f of findings) {
    const sig = `${f.ruleId}::${f.location?.path ?? ""}::${f.location?.line ?? ""}::${f.message}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      deduplicated.push(f);
    }
  }

  return sortFindings(deduplicated);
}

/**
 * Computes deterministic summary counts from a list of findings.
 */
export function computeReportSummary(
  findings: readonly QualityFinding[],
): HealthReportSummary {
  let fatalCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  let safeRepairableCount = 0;
  let reviewRequiredCount = 0;
  let manualCount = 0;

  for (const f of findings) {
    if (f.severity === "fatal") fatalCount += 1;
    else if (f.severity === "error") errorCount += 1;
    else if (f.severity === "warning") warningCount += 1;
    else if (f.severity === "info") infoCount += 1;

    if (f.repairability === "safe-auto") safeRepairableCount += 1;
    else if (f.repairability === "review-required") reviewRequiredCount += 1;
    else if (f.repairability === "manual") manualCount += 1;
  }

  return {
    totalFindings: findings.length,
    fatalCount,
    errorCount,
    warningCount,
    infoCount,
    safeRepairableCount,
    reviewRequiredCount,
    manualCount,
  };
}
