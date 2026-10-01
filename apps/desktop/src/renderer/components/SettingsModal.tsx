import React from "react";
import type { ReaderSettings, ReaderTheme } from "@reflowpress/reader";
import {
  clampFontSize,
  clampLineHeight,
  clampMargin,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "@reflowpress/reader";

export interface SettingsModalProps {
  isOpen: boolean;
  settings: ReaderSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: ReaderSettings) => void;
}

const FONT_OPTIONS = [
  { label: "Sans Serif", value: "system-ui, -apple-system, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "'SF Mono', Menlo, Consolas, monospace" },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  const isDark = settings.theme === "dark";
  const isSepia = settings.theme === "sepia";

  const modalBg = isDark ? "#1f2937" : isSepia ? "#f6ede0" : "#ffffff";
  const textColor = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#111827";
  const borderColor = isDark ? "#374151" : isSepia ? "#e2d2b5" : "#e5e7eb";

  const handleThemeChange = (theme: ReaderTheme) => {
    onUpdateSettings({ ...settings, theme });
  };

  const handleFontFamilyChange = (fontFamily: string) => {
    onUpdateSettings({ ...settings, fontFamily });
  };

  const handleFontSizeChange = (delta: number) => {
    const newSize = clampFontSize(settings.fontSize + delta);
    onUpdateSettings({ ...settings, fontSize: newSize });
  };

  const handleLineHeightChange = (lineHeight: number) => {
    onUpdateSettings({ ...settings, lineHeight: clampLineHeight(lineHeight) });
  };

  const handleMarginChange = (margin: number) => {
    onUpdateSettings({ ...settings, margin: clampMargin(margin) });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="settings-backdrop"
        onClick={onClose}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          zIndex: 40,
        }}
      />

      {/* Dialog */}
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "420px",
          maxWidth: "90vw",
          backgroundColor: modalBg,
          color: textColor,
          borderRadius: "8px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
          border: `1px solid ${borderColor}`,
          zIndex: 50,
          padding: "20px",
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
            id="settings-dialog-title"
            style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}
          >
            Reading Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: "18px",
              color: textColor,
            }}
          >
            ✕
          </button>
        </div>

        {/* Theme Section */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            Theme
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            <button
              type="button"
              onClick={() => handleThemeChange("light")}
              style={{
                padding: "8px",
                border:
                  settings.theme === "light"
                    ? "2px solid #2563eb"
                    : `1px solid ${borderColor}`,
                borderRadius: "6px",
                backgroundColor: "#ffffff",
                color: "#111827",
                cursor: "pointer",
                fontWeight: settings.theme === "light" ? 600 : 400,
              }}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("sepia")}
              style={{
                padding: "8px",
                border:
                  settings.theme === "sepia"
                    ? "2px solid #8f5b28"
                    : `1px solid ${borderColor}`,
                borderRadius: "6px",
                backgroundColor: "#fbf0d9",
                color: "#3c3226",
                cursor: "pointer",
                fontWeight: settings.theme === "sepia" ? 600 : 400,
              }}
            >
              Sepia
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("dark")}
              style={{
                padding: "8px",
                border:
                  settings.theme === "dark"
                    ? "2px solid #60a5fa"
                    : `1px solid ${borderColor}`,
                borderRadius: "6px",
                backgroundColor: "#181818",
                color: "#f3f4f6",
                cursor: "pointer",
                fontWeight: settings.theme === "dark" ? 600 : 400,
              }}
            >
              Dark
            </button>
          </div>
        </div>

        {/* Font Family */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            Typeface
          </label>
          <select
            value={settings.fontFamily}
            onChange={(e) => handleFontFamilyChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: `1px solid ${borderColor}`,
              backgroundColor: isDark ? "#374151" : "#ffffff",
              color: textColor,
              fontSize: "14px",
            }}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            Font Size ({settings.fontSize}px)
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={() => handleFontSizeChange(-2)}
              disabled={settings.fontSize <= MIN_FONT_SIZE}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                background: "transparent",
                color: textColor,
                cursor:
                  settings.fontSize <= MIN_FONT_SIZE ? "default" : "pointer",
                opacity: settings.fontSize <= MIN_FONT_SIZE ? 0.5 : 1,
                fontSize: "14px",
              }}
            >
              A -
            </button>
            <button
              type="button"
              onClick={() => handleFontSizeChange(2)}
              disabled={settings.fontSize >= MAX_FONT_SIZE}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                background: "transparent",
                color: textColor,
                cursor:
                  settings.fontSize >= MAX_FONT_SIZE ? "default" : "pointer",
                opacity: settings.fontSize >= MAX_FONT_SIZE ? 0.5 : 1,
                fontSize: "14px",
              }}
            >
              A +
            </button>
          </div>
        </div>

        {/* Line Spacing */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            Line Spacing
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            {[
              { label: "Tight", value: 1.3 },
              { label: "Normal", value: 1.6 },
              { label: "Relaxed", value: 2.0 },
            ].map((ls) => (
              <button
                key={ls.value}
                type="button"
                onClick={() => handleLineHeightChange(ls.value)}
                style={{
                  padding: "6px",
                  borderRadius: "6px",
                  border:
                    settings.lineHeight === ls.value
                      ? "2px solid #2563eb"
                      : `1px solid ${borderColor}`,
                  background: "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: settings.lineHeight === ls.value ? 600 : 400,
                }}
              >
                {ls.label}
              </button>
            ))}
          </div>
        </div>

        {/* Page Margins */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "8px",
            }}
          >
            Page Margins
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            {[
              { label: "Narrow", value: 16 },
              { label: "Normal", value: 32 },
              { label: "Wide", value: 48 },
            ].map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => handleMarginChange(m.value)}
                style={{
                  padding: "6px",
                  borderRadius: "6px",
                  border:
                    settings.margin === m.value
                      ? "2px solid #2563eb"
                      : `1px solid ${borderColor}`,
                  background: "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: settings.margin === m.value ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Done Button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              backgroundColor: isDark ? "#3b82f6" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
};
