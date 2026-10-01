export type ReaderTheme = "light" | "dark" | "sepia";

export interface ReaderSettings {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly margin: number;
  readonly theme: ReaderTheme;
}

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 36;
export const DEFAULT_FONT_SIZE = 16;

export const MIN_LINE_HEIGHT = 1.0;
export const MAX_LINE_HEIGHT = 3.0;
export const DEFAULT_LINE_HEIGHT = 1.6;

export const MIN_MARGIN = 8;
export const MAX_MARGIN = 96;
export const DEFAULT_MARGIN = 32;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: DEFAULT_LINE_HEIGHT,
  margin: DEFAULT_MARGIN,
  theme: "light",
};

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  return Math.min(Math.max(Math.round(size), MIN_FONT_SIZE), MAX_FONT_SIZE);
}

export function clampLineHeight(lineHeight: number): number {
  if (!Number.isFinite(lineHeight)) return DEFAULT_LINE_HEIGHT;
  const rounded = Math.round(lineHeight * 10) / 10;
  return Math.min(Math.max(rounded, MIN_LINE_HEIGHT), MAX_LINE_HEIGHT);
}

export function clampMargin(margin: number): number {
  if (!Number.isFinite(margin)) return DEFAULT_MARGIN;
  return Math.min(Math.max(Math.round(margin), MIN_MARGIN), MAX_MARGIN);
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(Math.max(progress, 0), 1);
}
