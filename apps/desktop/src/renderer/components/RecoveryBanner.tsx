import React from "react";

export interface RecoveryBannerProps {
  publicationTitle?: string;
  onRestore: () => void;
  onDismiss: () => void;
}

export const RecoveryBanner: React.FC<RecoveryBannerProps> = ({
  publicationTitle,
  onRestore,
  onDismiss,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#e0f2fe",
        color: "#0369a1",
        borderBottom: "1px solid #7dd3fc",
        padding: "10px 16px",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span>🔄</span>
        <span>
          ReflowPress recovered from an unexpected shutdown.
          {publicationTitle
            ? ` Would you like to restore your workspace with "${publicationTitle}"?`
            : " Would you like to restore your last open workspace?"}
        </span>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onRestore}
          style={{
            padding: "4px 10px",
            fontSize: "12px",
            backgroundColor: "#0284c7",
            color: "#ffffff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Restore Workspace
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: "4px 8px",
            fontSize: "12px",
            backgroundColor: "transparent",
            color: "#0369a1",
            border: "1px solid #7dd3fc",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
