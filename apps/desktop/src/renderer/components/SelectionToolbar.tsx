import React from "react";
import type { AnnotationColor } from "@reflowpress/annotations";

export interface SelectionToolbarProps {
  visible: boolean;
  selectedText: string;
  theme: "light" | "sepia" | "dark";
  onHighlight: (color: AnnotationColor) => void;
  onAddNote: (color: AnnotationColor) => void;
  onDismiss: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  visible,
  selectedText,
  theme,
  onHighlight,
  onAddNote,
  onDismiss,
}) => {
  if (!visible || !selectedText.trim()) return null;

  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const bg = isDark ? "#262626" : isSepia ? "#f4ebd0" : "#ffffff";
  const text = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#1f2937";
  const border = isDark ? "#404040" : isSepia ? "#e2d2b5" : "#e5e7eb";

  const colors: Array<{ color: AnnotationColor; bg: string; title: string }> = [
    { color: "yellow", bg: "#fef08a", title: "Yellow highlight" },
    { color: "green", bg: "#bbf7d0", title: "Green highlight" },
    { color: "blue", bg: "#bfdbfe", title: "Blue highlight" },
    { color: "pink", bg: "#fbcfe8", title: "Pink highlight" },
  ];

  return (
    <div
      className="selection-action-toolbar"
      style={{
        position: "fixed",
        bottom: "48px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: bg,
        color: text,
        border: `1px solid ${border}`,
        borderRadius: "24px",
        padding: "6px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        zIndex: 40,
        userSelect: "none",
        fontSize: "12px",
      }}
    >
      <span style={{ fontWeight: 600, color: isDark ? "#9ca3af" : "#6b7280" }}>
        Highlight:
      </span>
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {colors.map(({ color, bg: cBg, title }) => (
          <button
            key={color}
            type="button"
            onClick={() => onHighlight(color)}
            title={title}
            aria-label={title}
            style={{
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              backgroundColor: cBg,
              border: "1px solid rgba(0,0,0,0.25)",
              cursor: "pointer",
              padding: 0,
              transition: "transform 0.1s ease",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.transform = "scale(1.2)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.transform = "scale(1.0)")
            }
          />
        ))}
      </div>

      <div style={{ width: "1px", height: "16px", backgroundColor: border }} />

      <button
        type="button"
        onClick={() => onAddNote("yellow")}
        title="Add note to selection"
        aria-label="Add note to selection"
        style={{
          border: "none",
          background: "transparent",
          color: isDark ? "#60a5fa" : "#2563eb",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "12px",
          padding: "2px 6px",
        }}
      >
        📝 Add Note
      </button>

      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss toolbar"
        aria-label="Dismiss toolbar"
        style={{
          border: "none",
          background: "transparent",
          color: isDark ? "#9ca3af" : "#6b7280",
          cursor: "pointer",
          fontSize: "14px",
          padding: "2px 4px",
        }}
      >
        ✕
      </button>
    </div>
  );
};
