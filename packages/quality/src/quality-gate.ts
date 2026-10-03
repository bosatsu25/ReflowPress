import type { HealthReport, QualityFinding } from "./models.js";

export type QualityProfile = "baseline" | "reader-export";

export interface QualityGateResult {
  readonly passed: boolean;
  readonly profile: QualityProfile;
  readonly violations: readonly QualityFinding[];
  readonly report: HealthReport;
}

export function evaluateQualityGate(
  report: HealthReport,
  profile: QualityProfile = "baseline",
): QualityGateResult {
  const violations: QualityFinding[] = [];

  for (const finding of report.findings) {
    if (profile === "baseline") {
      if (finding.severity === "fatal" || finding.severity === "error") {
        violations.push(finding);
      }
    } else if (profile === "reader-export") {
      // Strict: fatal, error, plus text layer missing or geometry errors
      if (
        finding.severity === "fatal" ||
        finding.severity === "error" ||
        finding.ruleId === "PDF-TEXT-001" ||
        finding.ruleId === "PDF-GEOM-001"
      ) {
        violations.push(finding);
      }
    }
  }

  return {
    passed: violations.length === 0,
    profile,
    violations,
    report,
  };
}
