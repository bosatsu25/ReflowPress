import type { SearchSnippet } from "./models.js";

/** Closing tags that separate blocks of text (replaced by a space). */
const BLOCK_CLOSE_TAG = /^<\/(?:p|div|h[1-6]|li|blockquote|tr)\s*>$/i;

/** ASCII-only lowercase: keeps string indices aligned with the original. */
function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Returns the index after the raw-text element (`script`/`style`) that starts
 * at `start`, or -1 when `start` does not open such an element or the element
 * is never closed.
 *
 * `failedFrom` memoizes failed searches: once no complete closing tag exists
 * after some start position, none exists after any later one either (scan
 * positions only move forward), which keeps the overall scan linear even for
 * thousands of unclosed openers.
 */
function skipRawTextElement(
  lower: string,
  start: number,
  name: "script" | "style",
  failedFrom: Map<string, number>,
): number {
  if (!lower.startsWith(`<${name}`, start)) return -1;
  if (isWordChar(lower[start + name.length + 1])) return -1;
  if (start >= (failedFrom.get(name) ?? Infinity)) return -1;
  const close = lower.indexOf(`</${name}`, start + name.length + 1);
  const end = close === -1 ? -1 : lower.indexOf(">", close + name.length + 2);
  if (end === -1) {
    failedFrom.set(name, start);
    return -1;
  }
  return end + 1;
}

/**
 * Strips script, style, and HTML tags, decodes standard and numeric entities,
 * and normalizes whitespace while preserving text flow.
 *
 * Implemented as a single forward scan using indexOf (linear time), so
 * unclosed `<script`, `<style`, `<!--` or `<` runs in untrusted content cannot
 * cause catastrophic regex backtracking on the UI thread.
 */
export function extractVisibleText(htmlOrXml: string): string {
  if (!htmlOrXml) return "";

  const source = htmlOrXml;
  const lower = asciiLowerCase(source);
  const parts: string[] = [];
  const failedFrom = new Map<string, number>();
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open === -1) {
      parts.push(source.slice(index));
      break;
    }
    parts.push(source.slice(index, open));

    // 1. Comments
    if (
      source.startsWith("<!--", open) &&
      open < (failedFrom.get("comment") ?? Infinity)
    ) {
      const end = source.indexOf("-->", open + 4);
      if (end !== -1) {
        parts.push(" ");
        index = end + 3;
        continue;
      }
      failedFrom.set("comment", open);
    }

    // 2. Scripts and styles (with content)
    const rawTextEnd = Math.max(
      skipRawTextElement(lower, open, "script", failedFrom),
      skipRawTextElement(lower, open, "style", failedFrom),
    );
    if (rawTextEnd !== -1) {
      parts.push(" ");
      index = rawTextEnd;
      continue;
    }

    // 3. Any other tag: up to the next ">"
    const close = source.indexOf(">", open + 1);
    if (close === -1) {
      // No further tag can be closed: the rest is text.
      parts.push(source.slice(open));
      break;
    }
    if (close === open + 1) {
      // "<>" is not a tag
      parts.push("<");
      index = open + 1;
      continue;
    }
    const tag = source.slice(open, close + 1);
    // Block-level closing tags separate words
    parts.push(BLOCK_CLOSE_TAG.test(tag) ? " " : "");
    index = close + 1;
  }

  // 4. Decode HTML entities
  let text = decodeHtmlEntities(parts.join(""));

  // 5. Normalize whitespace (collapse multiple spaces/tabs, preserve sensible spacing)
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/(\r\n|\n|\r)[ \t]*/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function fromCodePointSafe(codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

/** Decodes named, decimal and hexadecimal character references in one pass. */
export function decodeHtmlEntities(str: string): string {
  return str.replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(nbsp|amp|lt|gt|quot|apos));/g,
    (match, hex: string | undefined, dec: string | undefined, name) => {
      if (hex !== undefined) return fromCodePointSafe(parseInt(hex, 16));
      if (dec !== undefined) return fromCodePointSafe(parseInt(dec, 10));
      return NAMED_ENTITIES.get(String(name)) ?? match;
    },
  );
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
