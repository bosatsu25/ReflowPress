import React from "react";
import type { ReaderSettings } from "@reflowpress/reader";

export interface FooterProps {
  progressLabel: string;
  progressPercent: number; // 0 to 100
  canGoPrevious: boolean;
  canGoNext: boolean;
  theme: ReaderSettings["theme"];
  onPrevious: () => void;
  onNext: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  progressLabel,
  progressPercent,
  canGoPrevious,
  canGoNext,
  theme,
  onPrevious,
  onNext,
}) => {
  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const footerBg = isDark ? "#1e1e1e" : isSepia ? "#f4ebd0" : "#ffffff";
  const textColor = isDark ? "#9ca3af" : isSepia ? "#5c4f3e" : "#6b7280";
  const borderColor = isDark ? "#333333" : isSepia ? "#e2d2b5" : "#e5e7eb";
  const barBg = isDark ? "#374151" : isSepia ? "#e5d9c2" : "#e5e7eb";
  const barFill = isDark ? "#60a5fa" : isSepia ? "#8f5b28" : "#2563eb";

  return (
    <footer
      className="reader-footer"
      style={{
        position: "relative",
        height: "40px",
        backgroundColor: footerBg,
        color: textColor,
        borderTop: `1px solid ${borderColor}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        userSelect: "none",
        zIndex: 20,
      }}
    >
      {/* Progress Track */}
      <div
        className="footer-progress-track"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "3px",
          backgroundColor: barBg,
        }}
      >
        <div
          className="footer-progress-fill"
          style={{
            height: "100%",
            width: `${Math.min(Math.max(progressPercent, 0), 100)}%`,
            backgroundColor: barFill,
            transition: "width 0.2s ease-out",
          }}
        />
      </div>

      <button
        type="button"
        onClick={onPrevious}
        disabled={!canGoPrevious}
        aria-label="Previous Page or Chapter"
        style={{
          padding: "4px 12px",
          fontSize: "13px",
          border: `1px solid ${borderColor}`,
          borderRadius: "4px",
          background: "transparent",
          color: textColor,
          cursor: canGoPrevious ? "pointer" : "default",
          opacity: canGoPrevious ? 1 : 0.4,
        }}
      >
        ‹ Previous
      </button>

      <span style={{ fontSize: "12px", fontWeight: 500 }}>{progressLabel}</span>

      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next Page or Chapter"
        style={{
          padding: "4px 12px",
          fontSize: "13px",
          border: `1px solid ${borderColor}`,
          borderRadius: "4px",
          background: "transparent",
          color: textColor,
          cursor: canGoNext ? "pointer" : "default",
          opacity: canGoNext ? 1 : 0.4,
        }}
      >
        Next ›
      </button>
    </footer>
  );
};
