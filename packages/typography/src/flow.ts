import type {
  ReadingFlow,
  ResolvedWritingMode,
  TextDirection,
  WritingMode,
} from "./models.js";

export interface DocumentTypographyContext {
  readonly renditionDirection?: string | undefined;
  readonly pageProgressionDirection?: string | undefined;
  readonly direction?: string | undefined;
  readonly cssWritingMode?: string | undefined;
  readonly markupSnippet?: string | undefined;
}

export function resolveWritingMode(
  requestedMode: WritingMode,
  context?: DocumentTypographyContext,
): ResolvedWritingMode {
  if (requestedMode === "vertical-rl") {
    return "vertical-rl";
  }
  if (requestedMode === "horizontal-tb") {
    return "horizontal-tb";
  }

  // "auto": determine from document context
  if (context) {
    if (
      context.pageProgressionDirection === "rtl" ||
      context.renditionDirection === "rtl"
    ) {
      // In Japanese EPUB 3 publications, vertical writing implies page-progression-direction="rtl"
      return "vertical-rl";
    }
    if (context.cssWritingMode && context.cssWritingMode.includes("vertical")) {
      return "vertical-rl";
    }
    if (
      context.markupSnippet &&
      (context.markupSnippet.includes("vertical-rl") ||
        context.markupSnippet.includes("-epub-writing-mode: vertical-rl") ||
        context.markupSnippet.includes("-epub-writing-mode: tb-rl"))
    ) {
      return "vertical-rl";
    }
  }

  return "horizontal-tb";
}

export function resolveReadingFlow(
  resolvedMode: ResolvedWritingMode,
  direction: TextDirection = "ltr",
): ReadingFlow {
  if (resolvedMode === "vertical-rl") {
    return {
      axis: "horizontal",
      progression: "forward-negative",
      writingMode: "vertical-rl",
      direction,
    };
  }

  return {
    axis: "vertical",
    progression: "forward-positive",
    writingMode: "horizontal-tb",
    direction,
  };
}

export function calculateProgressionDelta(
  flow: ReadingFlow,
  action: "next" | "previous",
  viewport: { width: number; height: number },
  stepRatio = 0.85,
): { deltaX: number; deltaY: number } {
  const isNext = action === "next";

  if (flow.writingMode === "vertical-rl") {
    // Columns progress from right to left (negative horizontal step)
    const stepSize = Math.max(100, Math.round(viewport.width * stepRatio));
    return {
      deltaX: isNext ? -stepSize : stepSize,
      deltaY: 0,
    };
  }

  // horizontal-tb: lines progress downwards (positive vertical step)
  const stepSize = Math.max(100, Math.round(viewport.height * stepRatio));
  return {
    deltaX: 0,
    deltaY: isNext ? stepSize : -stepSize,
  };
}
