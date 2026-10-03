import React, { useState, useEffect } from "react";
import type { HealthReport, QualityFinding } from "@reflowpress/quality";
import type {
  RepairPlan,
  RepairPreview,
  RepairResult,
} from "@reflowpress/repair";

export interface HealthModalProps {
  readonly isOpen: boolean;
  readonly publicationPath: string;
  readonly onClose: () => void;
  readonly onRepaired?: ((repairedPath: string) => void) | undefined;
}

export const HealthModal: React.FC<HealthModalProps> = ({
  isOpen,
  publicationPath,
  onClose,
  onRepaired,
}) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [preview, setPreview] = useState<RepairPreview | null>(null);
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"findings" | "repair">("findings");

  useEffect(() => {
    if (!isOpen || !publicationPath) return;

    let isMounted = true;
    setLoading(true);
    setError(null);
    setRepairResult(null);

    const bridge = window.reflowPressDesktop;
    if (!bridge || !bridge.inspectPublication) {
      setError("Desktop bridge inspect API not available.");
      setLoading(false);
      return;
    }

    Promise.all([
      bridge.inspectPublication(publicationPath),
      bridge.repairPublication
        ? bridge.repairPublication(publicationPath, { apply: false })
        : null,
    ])
      .then(([rep, previewData]) => {
        if (!isMounted) return;
        setReport(rep as HealthReport);
        if (previewData && "plan" in previewData) {
          setPlan(previewData.plan);
          setPreview(previewData.preview);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, publicationPath]);

  if (!isOpen) return null;

  const handleApplyRepair = async () => {
    const bridge = window.reflowPressDesktop;
    if (!bridge || !bridge.repairPublication) return;

    setRepairing(true);
    setError(null);

    try {
      const res = (await bridge.repairPublication(publicationPath, {
        apply: true,
      })) as RepairResult;
      setRepairResult(res);
      if (res.success && res.outputPath && onRepaired) {
        onRepaired(res.outputPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="health-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="modal-card"
        style={{
          backgroundColor: "var(--color-bg, #ffffff)",
          color: "var(--color-text, #1a1a1a)",
          borderRadius: "8px",
          width: "90%",
          maxWidth: "760px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h2
            id="health-modal-title"
            style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}
          >
            Publication Health & Safe Repair
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Health & Repair Dialog"
            style={{
              background: "none",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Live Status Region */}
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "8px 12px",
            marginBottom: "12px",
            backgroundColor: "var(--color-bg-secondary, #f5f5f5)",
            borderRadius: "4px",
            fontSize: "0.875rem",
          }}
        >
          {loading && "Inspecting publication health..."}
          {repairing &&
            "Applying safe repairs and verifying with re-inspection..."}
          {!loading && !repairing && report && (
            <span>
              <strong>File:</strong> {report.publicationPath} |{" "}
              <strong>Total Findings:</strong> {report.summary.totalFindings} (
              {report.summary.fatalCount} Fatal, {report.summary.errorCount}{" "}
              Error, {report.summary.warningCount} Warning)
            </span>
          )}
          {error && (
            <span style={{ color: "#d32f2f", fontWeight: "bold" }}>
              {" "}
              Error: {error}
            </span>
          )}
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #ddd",
            marginBottom: "16px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("findings")}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom:
                activeTab === "findings" ? "2px solid #1976d2" : "none",
              fontWeight: activeTab === "findings" ? "600" : "400",
              background: "none",
              cursor: "pointer",
            }}
          >
            Diagnostics ({report?.summary.totalFindings ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("repair")}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom:
                activeTab === "repair" ? "2px solid #1976d2" : "none",
              fontWeight: activeTab === "repair" ? "600" : "400",
              background: "none",
              cursor: "pointer",
            }}
          >
            Safe Repair ({plan?.safeActionCount ?? 0} safe actions)
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
          {activeTab === "findings" && (
            <div>
              {report?.findings.length === 0 ? (
                <div
                  style={{
                    padding: "24px 0",
                    textAlign: "center",
                    color: "#388e3c",
                  }}
                >
                  <strong>
                    ✓ No diagnostic issues found. Publication is healthy!
                  </strong>
                </div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {report?.findings.map((f: QualityFinding, idx: number) => {
                    const badgeColor =
                      f.severity === "fatal"
                        ? "#b71c1c"
                        : f.severity === "error"
                          ? "#d32f2f"
                          : f.severity === "warning"
                            ? "#e65100"
                            : "#0288d1";

                    return (
                      <li
                        key={`${f.ruleId}-${idx}`}
                        style={{
                          padding: "10px 12px",
                          marginBottom: "8px",
                          border: "1px solid #e0e0e0",
                          borderRadius: "4px",
                          backgroundColor: "#fafafa",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "4px",
                          }}
                        >
                          <span
                            style={{
                              backgroundColor: badgeColor,
                              color: "#ffffff",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                            }}
                          >
                            [{f.severity.toUpperCase()}]
                          </span>
                          <span
                            style={{ fontWeight: "600", fontSize: "0.875rem" }}
                          >
                            {f.ruleId}
                          </span>
                          <span style={{ color: "#666", fontSize: "0.75rem" }}>
                            ({f.category})
                          </span>
                          <span
                            style={{
                              marginLeft: "auto",
                              fontSize: "0.75rem",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              backgroundColor:
                                f.repairability === "safe-auto"
                                  ? "#e8f5e9"
                                  : "#fff3e0",
                              color:
                                f.repairability === "safe-auto"
                                  ? "#2e7d32"
                                  : "#e65100",
                              fontWeight: "bold",
                            }}
                          >
                            Repair: {f.repairability}
                          </span>
                        </div>
                        <div
                          style={{ fontSize: "0.875rem", marginBottom: "4px" }}
                        >
                          {f.message}
                        </div>
                        {f.location?.path && (
                          <div style={{ fontSize: "0.75rem", color: "#666" }}>
                            Location: {f.location.path}
                            {f.location.line ? `:${f.location.line}` : ""}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {activeTab === "repair" && (
            <div>
              {repairResult ? (
                <div
                  style={{
                    padding: "16px",
                    borderRadius: "4px",
                    backgroundColor: repairResult.success
                      ? "#e8f5e9"
                      : "#ffebee",
                    color: repairResult.success ? "#2e7d32" : "#c62828",
                  }}
                >
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>
                    {repairResult.success
                      ? "✓ Repair Completed Successfully"
                      : "✗ Repair Failed"}
                  </h3>
                  {repairResult.success ? (
                    <div>
                      <p style={{ margin: "0 0 4px 0" }}>
                        New safe publication created:{" "}
                        <code>{repairResult.outputPath}</code>
                      </p>
                      <p style={{ margin: "0", fontSize: "0.875rem" }}>
                        Original file remains untouched. Re-inspection verified
                        0 new regressions.
                      </p>
                    </div>
                  ) : (
                    <p style={{ margin: 0 }}>{repairResult.error}</p>
                  )}
                </div>
              ) : (
                <div>
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: "#555",
                      marginTop: 0,
                    }}
                  >
                    ReflowPress only applies{" "}
                    <strong>strictly safe, non-destructive repairs</strong>{" "}
                    (e.g. restoring uncompressed canonical mimetype, correcting
                    manifest media-types). It never deletes unreferenced assets
                    or fabricates synthetic metadata.
                  </p>

                  {plan?.actions.length === 0 ? (
                    <div
                      style={{
                        padding: "16px 0",
                        textAlign: "center",
                        color: "#666",
                      }}
                    >
                      No safe repair actions required for this publication.
                    </div>
                  ) : (
                    <div>
                      <h4
                        style={{ margin: "12px 0 8px 0", fontSize: "0.9rem" }}
                      >
                        Planned Actions ({plan?.actions.length}):
                      </h4>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          margin: "0 0 16px 0",
                        }}
                      >
                        {plan?.actions.map((act) => (
                          <li
                            key={act.id}
                            style={{
                              padding: "8px 12px",
                              marginBottom: "6px",
                              border: "1px solid #e0e0e0",
                              borderRadius: "4px",
                              backgroundColor: "#fafafa",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <strong style={{ fontSize: "0.875rem" }}>
                                {act.title}
                              </strong>
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  fontWeight: "bold",
                                  color:
                                    act.risk === "safe" ? "#2e7d32" : "#e65100",
                                }}
                              >
                                [{act.risk.toUpperCase()}]
                              </span>
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "#555" }}>
                              {act.description}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {preview && preview.diffs.length > 0 && (
                        <div style={{ marginBottom: "16px" }}>
                          <h4
                            style={{ margin: "0 0 8px 0", fontSize: "0.9rem" }}
                          >
                            Preview Diffs:
                          </h4>
                          {preview.diffs.map((diff, i) => (
                            <div
                              key={i}
                              style={{
                                padding: "8px",
                                backgroundColor: "#f5f5f5",
                                borderRadius: "4px",
                                marginBottom: "8px",
                                fontSize: "0.75rem",
                                fontFamily: "monospace",
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: "bold",
                                  marginBottom: "4px",
                                }}
                              >
                                File: {diff.file}
                              </div>
                              <div style={{ color: "#b71c1c" }}>
                                - {diff.before}
                              </div>
                              <div style={{ color: "#2e7d32" }}>
                                + {diff.after}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleApplyRepair}
                        disabled={repairing}
                        style={{
                          backgroundColor: "#1976d2",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "4px",
                          padding: "10px 18px",
                          fontWeight: "bold",
                          cursor: repairing ? "not-allowed" : "pointer",
                          opacity: repairing ? 0.7 : 1,
                        }}
                      >
                        {repairing
                          ? "Repairing & Verifying..."
                          : "Apply Safe Repairs (Non-Destructive)"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid #eee",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              backgroundColor: "transparent",
              border: "1px solid #ccc",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
