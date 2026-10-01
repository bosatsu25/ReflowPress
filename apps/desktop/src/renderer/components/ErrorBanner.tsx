import React from "react";

export interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  onOpenFile: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  onDismiss,
  onOpenFile,
}) => {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#fee2e2",
        color: "#991b1b",
        borderBottom: "1px solid #f87171",
        padding: "10px 16px",
        fontSize: "13px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span>⚠️</span>
        <span>{message}</span>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={onOpenFile}
          style={{
            padding: "4px 8px",
            fontSize: "12px",
            backgroundColor: "#dc2626",
            color: "#ffffff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Try Another File
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: "4px 8px",
            fontSize: "12px",
            backgroundColor: "transparent",
            color: "#991b1b",
            border: "1px solid #f87171",
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
