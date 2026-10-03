import type { SearchSnippet } from "./models.js";

/**
 * Strips script, style, and HTML tags, decodes standard and numeric entities,
 * and normalizes whitespace while preserving text flow.
 */
export function extractVisibleText(htmlOrXml: string): string {
  if (!htmlOrXml) return "";

  // 1. Remove scripts and styles completely
  let text = htmlOrXml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // 2. Replace block level tags with newlines/spaces
  text = text.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, " ");

  // 3. Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // 4. Decode HTML entities
  text = decodeHtmlEntities(text);

  // 5. Normalize whitespace (collapse multiple spaces/tabs, preserve sensible spacing)
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/(\r\n|\n|\r)[ \t]*/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    });
}

/**
 * Creates a clean search snippet around match index, safely respecting
 * Unicode surrogate pair boundaries.
 */
export function createSearchSnippet(
  text: string,
  matchStart: number,
  matchLength: number,
  snippetWindowLength = 50,
): SearchSnippet {
  const matchEnd = matchStart + matchLength;
  const match = text.slice(matchStart, matchEnd);

  // Compute safe before index
  let beforeStart = Math.max(0, matchStart - snippetWindowLength);
  // Ensure we don't split a low surrogate
  if (beforeStart > 0 && isLowSurrogate(text.charCodeAt(beforeStart))) {
    beforeStart = Math.max(0, beforeStart - 1);
  }

  // Compute safe after index
  let afterEnd = Math.min(text.length, matchEnd + snippetWindowLength);
  // Ensure we don't split a high surrogate
  if (
    afterEnd < text.length &&
    isHighSurrogate(text.charCodeAt(afterEnd - 1))
  ) {
    afterEnd = Math.min(text.length, afterEnd + 1);
  }

  let before = text.slice(beforeStart, matchStart).replace(/\s+/g, " ");
  let after = text.slice(matchEnd, afterEnd).replace(/\s+/g, " ");

  if (beforeStart > 0) before = "…" + before;
  if (afterEnd < text.length) after = after + "…";

  return { before, match, after };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
