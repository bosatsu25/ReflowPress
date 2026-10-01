import React from "react";
import type { ReaderSettings } from "@reflowpress/reader";

export interface EmptyStateProps {
  theme: ReaderSettings["theme"];
  onOpenFile: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  theme,
  onOpenFile,
}) => {
  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const textColor = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#111827";
  const mutedColor = isDark ? "#9ca3af" : isSepia ? "#786551" : "#6b7280";
  const cardBorder = isDark ? "#374151" : isSepia ? "#ded0b5" : "#e5e7eb";
  const cardBg = isDark ? "#1f2937" : isSepia ? "#f4ebd8" : "#ffffff";

  return (
    <div
      className="empty-state-view"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: "32px",
        textAlign: "center",
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: "480px",
          maxWidth: "90%",
          padding: "40px 32px",
          backgroundColor: cardBg,
          borderRadius: "12px",
          border: `1px solid ${cardBorder}`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            backgroundColor: isDark ? "#2563eb" : "#dbeafe",
            color: isDark ? "#ffffff" : "#1d4ed8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "32px",
            marginBottom: "20px",
          }}
        >
          📖
        </div>

        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "20px",
            fontWeight: 700,
            color: textColor,
          }}
        >
          ReflowPress Workbench
        </h1>

        <p
          style={{
            margin: "0 0 24px 0",
            fontSize: "14px",
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          Open a local EPUB or PDF publication to start reading with reflowable
          typography, chapter navigation, and offline reading state.
        </p>

        <button
          type="button"
          onClick={onOpenFile}
          style={{
            padding: "10px 24px",
            backgroundColor: "#2563eb",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: 600,
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 2px 4px rgba(37,99,235,0.2)",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>📂</span>
          <span>Open Publication</span>
        </button>

        <div style={{ marginTop: "24px", fontSize: "12px", color: mutedColor }}>
          Supported formats: <strong>.epub</strong>, <strong>.pdf</strong>
        </div>
      </div>
    </div>
  );
};
