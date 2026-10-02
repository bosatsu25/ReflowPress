import React from "react";
import type { ReaderSettings } from "@reflowpress/reader";

export interface HeaderProps {
  title: string;
  hasDocument: boolean;
  hasToc: boolean;
  tocOpen: boolean;
  theme: ReaderSettings["theme"];
  viewMode?: "library" | "reader";
  onOpenFile: () => void;
  onToggleToc: () => void;
  onOpenSettings: () => void;
  onCloseDocument: () => void;
  onSwitchToLibrary?: () => void;
  onSwitchToReader?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  hasDocument,
  hasToc,
  tocOpen,
  theme,
  viewMode = "reader",
  onOpenFile,
  onToggleToc,
  onOpenSettings,
  onCloseDocument,
  onSwitchToLibrary,
  onSwitchToReader,
}) => {
  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const headerBg = isDark ? "#1e1e1e" : isSepia ? "#f4ebd0" : "#ffffff";
  const textColor = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#1f2937";
  const borderColor = isDark ? "#333333" : isSepia ? "#e2d2b5" : "#e5e7eb";

  return (
    <header
      className="reader-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "48px",
        padding: "0 16px",
        backgroundColor: headerBg,
        color: textColor,
        borderBottom: `1px solid ${borderColor}`,
        userSelect: "none",
        zIndex: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          minWidth: 0,
        }}
      >
        {/* If in Reader mode, provide Back to Library button */}
        {viewMode === "reader" && onSwitchToLibrary && (
          <button
            type="button"
            onClick={onSwitchToLibrary}
            aria-label="Back to Library"
            title="Return to Library (Esc)"
            style={{
              padding: "6px 10px",
              cursor: "pointer",
              border: `1px solid ${borderColor}`,
              borderRadius: "4px",
              background: "transparent",
              color: textColor,
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontWeight: 500,
            }}
          >
            <span>←</span>
            <span>Library</span>
          </button>
        )}

        {viewMode === "reader" && hasDocument && (
          <button
            type="button"
            onClick={onToggleToc}
            disabled={!hasToc}
            aria-label="Table of Contents"
            title={
              hasToc
                ? tocOpen
                  ? "Close Contents"
                  : "Open Contents"
                : "No Table of Contents"
            }
            style={{
              padding: "6px 10px",
              cursor: hasToc ? "pointer" : "default",
              opacity: hasToc ? 1 : 0.4,
              border: `1px solid ${borderColor}`,
              borderRadius: "4px",
              background: tocOpen
                ? isDark
                  ? "#374151"
                  : "#e5e7eb"
                : "transparent",
              color: textColor,
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>☰</span>
            <span>TOC</span>
          </button>
        )}

        {viewMode === "library" && hasDocument && onSwitchToReader && (
          <button
            type="button"
            onClick={onSwitchToReader}
            aria-label="Resume Reading"
            title="Return to open document"
            style={{
              padding: "6px 10px",
              cursor: "pointer",
              border: `1px solid ${borderColor}`,
              borderRadius: "4px",
              background: isDark ? "#2563eb" : "#3b82f6",
              color: "#ffffff",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontWeight: 500,
            }}
          >
            <span>📖</span>
            <span>Resume Reading</span>
          </button>
        )}

        <span
          className="header-title"
          title={title}
          style={{
            fontWeight: 600,
            fontSize: "14px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "450px",
          }}
        >
          {title || "ReflowPress Workbench"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          onClick={onOpenFile}
          aria-label="Open File"
          title="Open EPUB or PDF (Ctrl+O)"
          style={{
            padding: "6px 12px",
            cursor: "pointer",
            border: `1px solid ${borderColor}`,
            borderRadius: "4px",
            background: "transparent",
            color: textColor,
            fontSize: "13px",
          }}
        >
          Open...
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Reader Settings"
          title="Reading Settings"
          style={{
            padding: "6px 10px",
            cursor: "pointer",
            border: `1px solid ${borderColor}`,
            borderRadius: "4px",
            background: "transparent",
            color: textColor,
            fontSize: "13px",
          }}
        >
          ⚙ Settings
        </button>

        {viewMode === "reader" && hasDocument && (
          <button
            type="button"
            onClick={onCloseDocument}
            aria-label="Close Document"
            title="Close Book"
            style={{
              padding: "6px 10px",
              cursor: "pointer",
              border: `1px solid ${borderColor}`,
              borderRadius: "4px",
              background: "transparent",
              color: textColor,
              fontSize: "13px",
            }}
          >
            ✕
          </button>
        )}
      </div>
    </header>
  );
};
