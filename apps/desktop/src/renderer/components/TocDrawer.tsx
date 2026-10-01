import React from "react";
import type { NavigationItem } from "@reflowpress/core";
import type { ReaderSettings } from "@reflowpress/reader";

export interface TocDrawerProps {
  isOpen: boolean;
  items: readonly NavigationItem[];
  currentHref: string;
  theme: ReaderSettings["theme"];
  onClose: () => void;
  onSelectHref: (href: string) => void;
}

const TocTree: React.FC<{
  items: readonly NavigationItem[];
  depth: number;
  currentHref: string;
  isDark: boolean;
  isSepia: boolean;
  onSelectHref: (href: string) => void;
}> = ({ items, depth, currentHref, isDark, isSepia, onSelectHref }) => {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((item, idx) => {
        const itemClean = item.href.split("#", 1)[0] ?? "";
        const currentClean = currentHref.split("#", 1)[0] ?? "";
        const isCurrent =
          item.href === currentHref ||
          (itemClean && itemClean === currentClean);

        const activeBg = isDark ? "#374151" : isSepia ? "#e7dcbe" : "#e0e7ff";
        const activeColor = isDark
          ? "#60a5fa"
          : isSepia
            ? "#8f5b28"
            : "#2563eb";
        const normalColor = isDark
          ? "#d1d5db"
          : isSepia
            ? "#3c3226"
            : "#374151";

        return (
          <li key={`${item.href}-${idx}`}>
            <button
              type="button"
              onClick={() => onSelectHref(item.href)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: `8px 16px 8px ${16 + depth * 16}px`,
                fontSize: "13px",
                border: "none",
                background: isCurrent ? activeBg : "transparent",
                color: isCurrent ? activeColor : normalColor,
                fontWeight: isCurrent ? 600 : 400,
                cursor: "pointer",
                display: "block",
                borderLeft: isCurrent
                  ? `3px solid ${activeColor}`
                  : "3px solid transparent",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={item.label}
            >
              {item.label}
            </button>
            {item.children && item.children.length > 0 && (
              <TocTree
                items={item.children}
                depth={depth + 1}
                currentHref={currentHref}
                isDark={isDark}
                isSepia={isSepia}
                onSelectHref={onSelectHref}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
};

export const TocDrawer: React.FC<TocDrawerProps> = ({
  isOpen,
  items,
  currentHref,
  theme,
  onClose,
  onSelectHref,
}) => {
  if (!isOpen) return null;

  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const drawerBg = isDark ? "#1f2937" : isSepia ? "#f6ede0" : "#ffffff";
  const textColor = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#111827";
  const borderColor = isDark ? "#374151" : isSepia ? "#e2d2b5" : "#e5e7eb";

  return (
    <>
      {/* Backdrop */}
      <div
        className="toc-backdrop"
        onClick={onClose}
        style={{
          position: "fixed",
          top: "48px",
          left: 0,
          right: 0,
          bottom: "40px",
          backgroundColor: "rgba(0, 0, 0, 0.35)",
          zIndex: 30,
        }}
      />

      {/* Drawer */}
      <aside
        className="toc-drawer"
        style={{
          position: "fixed",
          top: "48px",
          left: 0,
          bottom: "40px",
          width: "320px",
          maxWidth: "85vw",
          backgroundColor: drawerBg,
          color: textColor,
          boxShadow: "4px 0 16px rgba(0,0,0,0.15)",
          borderRight: `1px solid ${borderColor}`,
          zIndex: 35,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
            Table of Contents
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Table of Contents"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: "16px",
              color: textColor,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {items.length === 0 ? (
            <div
              style={{ padding: "16px", fontSize: "13px", color: "#6b7280" }}
            >
              No table of contents entries found.
            </div>
          ) : (
            <TocTree
              items={items}
              depth={0}
              currentHref={currentHref}
              isDark={isDark}
              isSepia={isSepia}
              onSelectHref={(href) => {
                onSelectHref(href);
                onClose();
              }}
            />
          )}
        </div>
      </aside>
    </>
  );
};
