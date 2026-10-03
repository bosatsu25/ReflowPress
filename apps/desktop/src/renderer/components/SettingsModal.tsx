import React, { useEffect, useRef } from "react";
import type { ReaderSettings, ReaderTheme } from "@reflowpress/reader";
import {
  clampFontSize,
  clampLineHeight,
  clampMargin,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "@reflowpress/reader";
import type { TateChuYokoMode, WritingMode } from "@reflowpress/typography";

export interface SettingsModalProps {
  isOpen: boolean;
  settings: ReaderSettings;
  onClose: () => void;
  onUpdateSettings: (newSettings: ReaderSettings) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

const FONT_OPTIONS = [
  {
    label: "Sans Serif / Gothic",
    value:
      "system-ui, -apple-system, 'Yu Gothic', 'Noto Sans CJK JP', sans-serif",
  },
  {
    label: "Serif / Mincho",
    value:
      "'Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif CJK JP', Georgia, serif",
  },
  { label: "Monospace", value: "'SF Mono', Menlo, Consolas, monospace" },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onUpdateSettings,
  triggerRef,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedElement.current =
        (document.activeElement as HTMLElement) || triggerRef?.current || null;

      // Focus first focusable element or modal container
      requestAnimationFrame(() => {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable && focusable.length > 0) {
          focusable[0].focus();
        } else {
          modalRef.current?.focus();
        }
      });

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          return;
        }

        if (e.key === "Tab") {
          const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable || focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        if (
          previouslyFocusedElement.current &&
          typeof previouslyFocusedElement.current.focus === "function"
        ) {
          previouslyFocusedElement.current.focus();
        }
      };
    }
  }, [isOpen, onClose, triggerRef]);

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

  const handleWritingModeChange = (writingMode: WritingMode) => {
    onUpdateSettings({ ...settings, writingMode });
  };

  const handleTcyChange = (tateChuYoko: TateChuYokoMode) => {
    onUpdateSettings({ ...settings, tateChuYoko });
  };

  const activeWritingMode = settings.writingMode ?? "auto";
  const activeTcy = settings.tateChuYoko ?? "author";

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
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "460px",
          maxWidth: "92vw",
          maxHeight: "90vh",
          overflowY: "auto",
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
            borderBottom: `1px solid ${borderColor}`,
            paddingBottom: "8px",
          }}
        >
          <h2
            id="settings-dialog-title"
            style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}
          >
            Reading Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Settings"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: textColor,
              fontSize: "18px",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Theme Settings */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
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
              aria-label="Light Theme"
              style={{
                padding: "8px",
                borderRadius: "6px",
                border:
                  settings.theme === "light"
                    ? "2px solid #2563eb"
                    : `1px solid ${borderColor}`,
                backgroundColor: "#ffffff",
                color: "#1f2937",
                cursor: "pointer",
                fontWeight: settings.theme === "light" ? 600 : 400,
              }}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("sepia")}
              aria-label="Sepia Theme"
              style={{
                padding: "8px",
                borderRadius: "6px",
                border:
                  settings.theme === "sepia"
                    ? "2px solid #2563eb"
                    : `1px solid ${borderColor}`,
                backgroundColor: "#fbf0d9",
                color: "#3f2d18",
                cursor: "pointer",
                fontWeight: settings.theme === "sepia" ? 600 : 400,
              }}
            >
              Sepia
            </button>
            <button
              type="button"
              onClick={() => handleThemeChange("dark")}
              aria-label="Dark Theme"
              style={{
                padding: "8px",
                borderRadius: "6px",
                border:
                  settings.theme === "dark"
                    ? "2px solid #2563eb"
                    : `1px solid ${borderColor}`,
                backgroundColor: "#111827",
                color: "#f3f4f6",
                cursor: "pointer",
                fontWeight: settings.theme === "dark" ? 600 : 400,
              }}
            >
              Dark
            </button>
          </div>
        </div>

        {/* Writing Mode Setting (Milestone 0.6) */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
            }}
          >
            Writing Mode
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            {[
              { label: "Auto (Author)", value: "auto" as const },
              { label: "Horizontal", value: "horizontal-tb" as const },
              { label: "Vertical (縦書き)", value: "vertical-rl" as const },
            ].map((wm) => (
              <button
                key={wm.value}
                type="button"
                onClick={() => handleWritingModeChange(wm.value)}
                aria-label={`Writing Mode ${wm.label}`}
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  border:
                    activeWritingMode === wm.value
                      ? "2px solid #2563eb"
                      : `1px solid ${borderColor}`,
                  background:
                    activeWritingMode === wm.value
                      ? isDark
                        ? "#1e3a8a"
                        : "#eff6ff"
                      : "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: activeWritingMode === wm.value ? 600 : 400,
                }}
              >
                {wm.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tate-Chu-Yoko (TCY) Setting (Milestone 0.6) */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "4px",
              opacity: 0.8,
            }}
          >
            Tate-Chu-Yoko / 縦中横 (Vertical Numeral Alignment)
          </label>
          <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "8px" }}>
            Controls horizontal orientation for 1–2 digit numbers in vertical
            text.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px",
            }}
          >
            {[
              { label: "Author", value: "author" as const },
              { label: "Assist (Auto)", value: "assist" as const },
              { label: "Off", value: "off" as const },
            ].map((tcy) => (
              <button
                key={tcy.value}
                type="button"
                onClick={() => handleTcyChange(tcy.value)}
                aria-label={`Tate-Chu-Yoko ${tcy.label}`}
                style={{
                  padding: "6px",
                  borderRadius: "6px",
                  border:
                    activeTcy === tcy.value
                      ? "2px solid #2563eb"
                      : `1px solid ${borderColor}`,
                  background:
                    activeTcy === tcy.value
                      ? isDark
                        ? "#1e3a8a"
                        : "#eff6ff"
                      : "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: activeTcy === tcy.value ? 600 : 400,
                }}
              >
                {tcy.label}
              </button>
            ))}
          </div>
        </div>

        {/* Font Family */}
        <div style={{ marginBottom: "16px" }}>
          <label
            htmlFor="font-family-select"
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
            }}
          >
            Font Family
          </label>
          <select
            id="font-family-select"
            value={settings.fontFamily}
            onChange={(e) => handleFontFamilyChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: `1px solid ${borderColor}`,
              backgroundColor: isDark ? "#111827" : "#ffffff",
              color: textColor,
              fontSize: "14px",
            }}
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
            }}
          >
            Font Size ({settings.fontSize}px)
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => handleFontSizeChange(-1)}
              disabled={settings.fontSize <= MIN_FONT_SIZE}
              aria-label="Decrease font size"
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
              onClick={() => handleFontSizeChange(1)}
              disabled={settings.fontSize >= MAX_FONT_SIZE}
              aria-label="Increase font size"
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

        {/* Line Height */}
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
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
              { label: "Loose", value: 2.0 },
            ].map((ls) => (
              <button
                key={ls.value}
                type="button"
                onClick={() => handleLineHeightChange(ls.value)}
                aria-label={`Line spacing ${ls.label}`}
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

        {/* Margins */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: "8px",
              opacity: 0.8,
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
                aria-label={`Page margins ${m.label}`}
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
            aria-label="Save and close settings"
            style={{
              padding: "8px 18px",
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
