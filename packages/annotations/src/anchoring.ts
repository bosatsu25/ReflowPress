import type { TextPositionSelector, TextQuoteSelector } from "./models.js";

export interface AnchorMatchResult {
  status: "matched" | "ambiguous" | "orphaned";
  range?: TextPositionSelector | undefined;
  confidence: number; // 0.0 to 1.0
}

/**
 * Robustly matches a TextQuoteSelector within normalized document text.
 * Implements W3C Web Annotation prefix/suffix disambiguation with fast-path position verification.
 */
export function matchTextQuote(
  content: string,
  selector: TextQuoteSelector,
  hintPosition?: TextPositionSelector | undefined,
): AnchorMatchResult {
  const { exact, prefix, suffix } = selector;

  if (!exact || exact.length === 0) {
    return { status: "orphaned", confidence: 0 };
  }

  // 1. Fast path: check hintPosition
  if (hintPosition) {
    const { start, end } = hintPosition;
    if (
      start >= 0 &&
      end <= content.length &&
      start < end &&
      content.slice(start, end) === exact
    ) {
      // Verify prefix/suffix if present
      let matchesContext = true;
      if (prefix && start >= prefix.length) {
        matchesContext = content.slice(start - prefix.length, start) === prefix;
      }
      if (suffix && end + suffix.length <= content.length) {
        matchesContext =
          matchesContext && content.slice(end, end + suffix.length) === suffix;
      }

      if (matchesContext) {
        return {
          status: "matched",
          range: { start, end },
          confidence: 1.0,
        };
      }
    }
  }

  // 2. Find all occurrences of exact text
  const occurrences: number[] = [];
  let pos = content.indexOf(exact);
  while (pos !== -1) {
    occurrences.push(pos);
    pos = content.indexOf(exact, pos + 1);
  }

  if (occurrences.length === 0) {
    // Exact text not found anywhere in content
    return { status: "orphaned", confidence: 0 };
  }

  if (occurrences.length === 1) {
    const singleIndex = occurrences[0]!;
    return {
      status: "matched",
      range: { start: singleIndex, end: singleIndex + exact.length },
      confidence: 0.9,
    };
  }

  // 3. Multiple occurrences: Disambiguate using prefix, suffix, and hint distance
  interface ScoredCandidate {
    index: number;
    score: number;
  }

  const scored: ScoredCandidate[] = occurrences.map((idx) => {
    let score = 0;
    const endIdx = idx + exact.length;

    if (prefix) {
      const actualPrefix = content.slice(Math.max(0, idx - prefix.length), idx);
      if (actualPrefix === prefix) {
        score += 3;
      } else if (actualPrefix.endsWith(prefix.slice(-5))) {
        score += 1;
      }
    }

    if (suffix) {
      const actualSuffix = content.slice(
        endIdx,
        Math.min(content.length, endIdx + suffix.length),
      );
      if (actualSuffix === suffix) {
        score += 3;
      } else if (actualSuffix.startsWith(suffix.slice(0, 5))) {
        score += 1;
      }
    }

    if (hintPosition) {
      const dist = Math.abs(idx - hintPosition.start);
      // Closer candidates get a higher bonus
      score += Math.max(0, 2 - dist / 500);
    }

    return { index: idx, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  const runnerUp = scored[1];

  // If best is clearly superior
  if (!runnerUp || best.score > runnerUp.score) {
    return {
      status: "matched",
      range: { start: best.index, end: best.index + exact.length },
      confidence: 0.8,
    };
  }

  // Ambiguous occurrence
  return {
    status: "ambiguous",
    range: { start: best.index, end: best.index + exact.length },
    confidence: 0.5,
  };
}
