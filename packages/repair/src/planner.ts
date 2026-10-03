import type { HealthReport } from "@reflowpress/quality";
import type { RepairAction, RepairPlan, RepairPreview } from "./models.js";

export const SAFE_AUTO_RULES: ReadonlySet<string> = new Set([
  "EPUB-CONTAINER-001",
  "EPUB-CONTAINER-002",
  "EPUB-CONTAINER-003",
  "EPUB-CONTAINER-004",
  "EPUB-MANIFEST-004",
]);

export interface PlanRepairsOptions {
  readonly allowReview?: boolean | undefined;
  readonly specificRuleIds?: readonly string[] | undefined;
}

export function planRepairs(
  healthReport: HealthReport,
  options: PlanRepairsOptions = {},
): { plan: RepairPlan; preview: RepairPreview } {
  const actions: RepairAction[] = [];
  const handledRules = new Set<string>();

  for (const finding of healthReport.findings) {
    if (
      options.specificRuleIds &&
      !options.specificRuleIds.includes(finding.ruleId)
    ) {
      continue;
    }

    if (
      !SAFE_AUTO_RULES.has(finding.ruleId) &&
      finding.repairability !== "safe-auto"
    ) {
      continue;
    }

    if (handledRules.has(finding.ruleId)) {
      // Avoid duplicate actions for the same rule if already handled
      if (
        finding.ruleId === "EPUB-CONTAINER-001" ||
        finding.ruleId === "EPUB-CONTAINER-002" ||
        finding.ruleId === "EPUB-CONTAINER-003"
      ) {
        continue;
      }
    }

    // 1. Mimetype rules (EPUB-CONTAINER-001, 002, 003)
    if (
      finding.ruleId === "EPUB-CONTAINER-001" ||
      finding.ruleId === "EPUB-CONTAINER-002" ||
      finding.ruleId === "EPUB-CONTAINER-003"
    ) {
      if (!handledRules.has("canonical-mimetype")) {
        handledRules.add("canonical-mimetype");
        handledRules.add("EPUB-CONTAINER-001");
        handledRules.add("EPUB-CONTAINER-002");
        handledRules.add("EPUB-CONTAINER-003");

        actions.push({
          id: "action-canonical-mimetype",
          ruleId: finding.ruleId,
          type: "canonical-mimetype",
          title: "Restore canonical uncompressed mimetype",
          description:
            "Rewrite 'mimetype' as the first uncompressed entry with exact content 'application/epub+zip'.",
          risk: "safe",
          targetFile: "mimetype",
          beforeSnippet:
            (finding.evidence?.find((e) => e.key === "actualMimetype")
              ?.value as string | undefined) ?? "<missing or compressed>",
          afterSnippet: "application/epub+zip",
        });
      }
      continue;
    }

    // 2. Missing container.xml (EPUB-CONTAINER-004)
    if (finding.ruleId === "EPUB-CONTAINER-004") {
      actions.push({
        id: "action-container-xml",
        ruleId: "EPUB-CONTAINER-004",
        type: "container-xml",
        title: "Create standard META-INF/container.xml",
        description:
          "Generate standard container.xml pointing to detected OPF package document.",
        risk: "safe",
        targetFile: "META-INF/container.xml",
        beforeSnippet: "<missing>",
        afterSnippet:
          '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="..." media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>',
      });
      handledRules.add("EPUB-CONTAINER-004");
      continue;
    }

    // 3. Manifest media-type mismatch (EPUB-MANIFEST-004)
    if (
      finding.ruleId === "EPUB-MANIFEST-004" &&
      finding.repairability === "safe-auto"
    ) {
      const declared =
        (finding.evidence?.find((e) => e.key === "declaredMime")?.value as
          string | undefined) ?? "";
      const expected =
        (finding.evidence?.find((e) => e.key === "expectedMime")?.value as
          string | undefined) ?? "";
      const itemId =
        (finding.evidence?.find((e) => e.key === "id")?.value as
          string | undefined) ?? "";

      actions.push({
        id: `action-manifest-mediatype-${itemId || actions.length}`,
        ruleId: "EPUB-MANIFEST-004",
        type: "manifest-mediatype",
        title: `Correct manifest media-type for item '${itemId}'`,
        description: `Update declared media-type from '${declared}' to unambiguous standard '${expected}'.`,
        risk: "safe",
        targetFile: finding.location?.path ?? "content.opf",
        beforeSnippet: `media-type="${declared}"`,
        afterSnippet: `media-type="${expected}"`,
      });
      continue;
    }
  }

  let safeActionCount = 0;
  let reviewActionCount = 0;
  let manualActionCount = 0;

  for (const a of actions) {
    if (a.risk === "safe") safeActionCount += 1;
    else if (a.risk === "review") reviewActionCount += 1;
    else if (a.risk === "manual") manualActionCount += 1;
  }

  const plan: RepairPlan = {
    publicationPath: healthReport.publicationPath,
    actions,
    safeActionCount,
    reviewActionCount,
    manualActionCount,
  };

  const preview: RepairPreview = {
    publicationPath: healthReport.publicationPath,
    plannedActions: actions,
    diffs: actions.map((a) => ({
      file: a.targetFile,
      before: a.beforeSnippet ?? "",
      after: a.afterSnippet ?? "",
    })),
  };

  return { plan, preview };
}
