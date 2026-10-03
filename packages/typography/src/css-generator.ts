import type {
  JapaneseTypographySettings,
  ResolvedWritingMode,
} from "./models.js";

export interface TypographyCssOptions {
  readonly resolvedWritingMode?: ResolvedWritingMode | undefined;
  readonly fontFamily?: string | undefined;
  readonly fontSizePx?: number | undefined;
  readonly lineHeight?: number | undefined;
  readonly marginPx?: number | undefined;
  readonly theme?: "light" | "dark" | "sepia" | undefined;
}

/**
 * Normalizes legacy EPUB 2/3 proprietary vendor prefixes into standard modern CSS.
 * Operates purely on strings without mutating underlying files.
 */
export function normalizeLegacyEpubCss(css: string): string {
  if (!css) return "";

  return (
    css
      // -epub-writing-mode
      .replace(
        /-epub-writing-mode\s*:\s*(?:vertical-rl|tb-rl)/gi,
        "writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl",
      )
      .replace(
        /-epub-writing-mode\s*:\s*(?:horizontal-tb|lr-tb)/gi,
        "writing-mode: horizontal-tb; -webkit-writing-mode: horizontal-tb",
      )
      // -epub-text-orientation
      .replace(
        /-epub-text-orientation\s*:\s*sideways-right/gi,
        "text-orientation: sideways",
      )
      .replace(
        /-epub-text-orientation\s*:\s*upright/gi,
        "text-orientation: upright",
      )
      .replace(
        /-epub-text-orientation\s*:\s*mixed/gi,
        "text-orientation: mixed",
      )
      // -epub-text-combine
      .replace(
        /-epub-text-combine\s*:\s*(?:horizontal|all)/gi,
        "text-combine-upright: all; -webkit-text-combine: horizontal",
      )
      // -epub-ruby-position
      .replace(/-epub-ruby-position\s*:\s*over/gi, "ruby-position: over")
      .replace(/-epub-ruby-position\s*:\s*under/gi, "ruby-position: under")
      // -epub-line-break
      .replace(
        /-epub-line-break\s*:\s*strict/gi,
        "line-break: strict; -webkit-line-break: strict",
      )
      // -epub-word-break
      .replace(/-epub-word-break\s*:\s*normal/gi, "word-break: normal")
  );
}

/**
 * Generates an isolated stylesheet for publication content (EPUB iframe or PDF conversion target).
 */
export function generateTypographyCss(
  settings: JapaneseTypographySettings,
  options: TypographyCssOptions = {},
): string {
  const writingMode =
    options.resolvedWritingMode ??
    (settings.writingMode === "auto" ? "horizontal-tb" : settings.writingMode);
  const isVertical = writingMode === "vertical-rl";

  const themeColors = {
    light: { bg: "#ffffff", fg: "#1f2937" },
    dark: { bg: "#111827", fg: "#f3f4f6" },
    sepia: { bg: "#fbf0d9", fg: "#3f2d18" },
  };

  const selectedTheme =
    options.theme && themeColors[options.theme]
      ? themeColors[options.theme]
      : themeColors.light;

  const fontFam = options.fontFamily
    ? `font-family: ${options.fontFamily}, sans-serif !important;`
    : `font-family: "Noto Serif CJK JP", "Yu Mincho", "Hiragino Mincho ProN", serif, sans-serif;`;

  const fontSize = options.fontSizePx
    ? `font-size: ${options.fontSizePx}px !important;`
    : "";
  const lineHeight = options.lineHeight
    ? `line-height: ${options.lineHeight} !important;`
    : "line-height: 1.8;";
  const marginPx = options.marginPx !== undefined ? options.marginPx : 32;

  const paddingRule = isVertical
    ? `padding: ${marginPx}px ${Math.round(marginPx * 1.2)}px !important;`
    : `padding: ${Math.round(marginPx * 0.8)}px ${marginPx}px !important;`;

  const writingModeRules = isVertical
    ? `
  writing-mode: vertical-rl !important;
  -webkit-writing-mode: vertical-rl !important;
  text-orientation: mixed !important;
  direction: ltr !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  height: 100vh !important;
  max-height: 100vh !important;
  box-sizing: border-box !important;
`
    : `
  writing-mode: horizontal-tb !important;
  -webkit-writing-mode: horizontal-tb !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  box-sizing: border-box !important;
`;

  const lineBreakValue =
    settings.lineBreak === "auto" ? "strict" : settings.lineBreak;
  const rubyPosValue =
    settings.rubyPosition === "auto" ? "over" : settings.rubyPosition;

  return `
/* ReflowPress Typography & Layout Layer */
html {
${writingModeRules}
  background-color: ${selectedTheme.bg} !important;
  color: ${selectedTheme.fg} !important;
}

body {
${writingModeRules}
  margin: 0 !important;
  ${paddingRule}
  ${fontFam}
  ${fontSize}
  ${lineHeight}
  background-color: transparent !important;
  color: ${selectedTheme.fg} !important;
  line-break: ${lineBreakValue} !important;
  -webkit-line-break: ${lineBreakValue} !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
}

/* Ruby typography */
ruby {
  ruby-position: ${rubyPosValue};
}

rt {
  font-size: 0.5em;
  line-height: 1;
  user-select: none;
}

/* Tate-chu-yoko (TCY) */
.reflowpress-tcy {
  text-combine-upright: all !important;
  -webkit-text-combine: horizontal !important;
}

/* MathML Core baseline */
math {
  font-family: "Latin Modern Math", "Cambria Math", serif;
}

/* Forced Colors (High Contrast) */
@media (forced-colors: active) {
  mark.reflowpress-highlight {
    outline: 2px solid Highlight !important;
    background-color: transparent !important;
    color: HighlightText !important;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();
}
