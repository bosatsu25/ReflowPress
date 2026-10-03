import type { TateChuYokoMode } from "./models.js";

/**
 * Strips ReflowPress-injected TCY spans while preserving all inner text content.
 */
export function removeTcySpans(markup: string): string {
  if (!markup) return "";
  return markup.replace(
    /<span\s+class=["']reflowpress-tcy["'][^>]*>([\s\S]*?)<\/span>/gi,
    "$1",
  );
}

/**
 * Applies Tate-chu-yoko (TCY) assist transformation to an HTML markup string.
 * Wraps 1-2 digit ASCII numerals in vertical text within a <span class="reflowpress-tcy">
 * without modifying textContent or publication integrity.
 *
 * Idempotent: cleans any existing reflowpress-tcy spans first.
 */
export function applyTcyAssist(
  markup: string,
  mode: TateChuYokoMode = "author",
): string {
  if (!markup) return "";

  // Always clean any existing reflowpress-tcy spans to guarantee idempotence
  const cleanMarkup = removeTcySpans(markup);

  if (mode !== "assist") {
    // In "author" or "off" mode, do not inject assist spans
    return cleanMarkup;
  }

  // Process text outside of tags and scripts
  // Strategy: match HTML tags or text chunks
  const tagRegex = /<[^>]+>/g;
  let lastIndex = 0;
  let result = "";
  let inExemptTag = false; // e.g. <script>, <style>, <title>

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleanMarkup)) !== null) {
    const textChunk = cleanMarkup.substring(lastIndex, match.index);
    const tag = match[0];

    if (textChunk && !inExemptTag) {
      // In textChunk, replace 1-2 digit ASCII numerals surrounded by CJK or boundaries
      // e.g. 1-2 digits not part of a larger number
      // We look for 1-2 digits that are preceded/followed by non-digits or start/end of chunk
      const transformedText = textChunk.replace(
        /(?<![0-9a-zA-Z])([0-9]{1,2})(?![0-9a-zA-Z])/g,
        '<span class="reflowpress-tcy">$1</span>',
      );
      result += transformedText;
    } else {
      result += textChunk;
    }

    result += tag;
    lastIndex = match.index + tag.length;

    // Check if tag enters/exits exempt tag
    const lowerTag = tag.toLowerCase();
    if (
      lowerTag.startsWith("<script") ||
      lowerTag.startsWith("<style") ||
      lowerTag.startsWith("<head")
    ) {
      inExemptTag = true;
    } else if (
      lowerTag.startsWith("</script") ||
      lowerTag.startsWith("</style") ||
      lowerTag.startsWith("</head")
    ) {
      inExemptTag = false;
    }
  }

  // Trailing text chunk
  const remaining = cleanMarkup.substring(lastIndex);
  if (remaining && !inExemptTag) {
    result += remaining.replace(
      /(?<![0-9a-zA-Z])([0-9]{1,2})(?![0-9a-zA-Z])/g,
      '<span class="reflowpress-tcy">$1</span>',
    );
  } else {
    result += remaining;
  }

  return result;
}
