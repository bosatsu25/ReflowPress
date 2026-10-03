export type WritingMode = "auto" | "horizontal-tb" | "vertical-rl";

export type ResolvedWritingMode = "horizontal-tb" | "vertical-rl";

export type TextDirection = "ltr" | "rtl";

export type LineBreakRule = "auto" | "normal" | "strict" | "loose";

export type WordBreakRule = "normal" | "break-all" | "keep-all";

export type TateChuYokoMode = "author" | "assist" | "off";

export type RubyPosition = "over" | "under" | "auto";

export interface JapaneseTypographySettings {
  readonly writingMode: WritingMode;
  readonly lineBreak: LineBreakRule;
  readonly tateChuYoko: TateChuYokoMode;
  readonly rubyPosition: RubyPosition;
}

export interface ReadingFlow {
  readonly axis: "horizontal" | "vertical";
  readonly progression: "forward-positive" | "forward-negative";
  readonly writingMode: ResolvedWritingMode;
  readonly direction: TextDirection;
}

export interface TypographyProfile {
  readonly settings: JapaneseTypographySettings;
  readonly flow: ReadingFlow;
  readonly fontFamily?: string;
  readonly fontSizePx?: number;
  readonly lineHeight?: number;
}

export const DEFAULT_JAPANESE_TYPOGRAPHY_SETTINGS: JapaneseTypographySettings =
  {
    writingMode: "auto",
    lineBreak: "strict",
    tateChuYoko: "author",
    rubyPosition: "auto",
  };
