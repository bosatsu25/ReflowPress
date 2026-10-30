import type { NormalizedPublication } from "@reflowpress/core";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";
import {
  classifyUrl,
  resolveRelativePath,
  sanitizeSvgDocument,
  sanitizeXmlNode,
} from "./sanitizer.js";

export interface MarkdownExportOptions {
  readonly assetDirectoryName?: string | undefined;
}

export interface MarkdownExportResult {
  readonly markdown: string;
  readonly assets: Map<string, Uint8Array>;
  readonly warnings: readonly string[];
}

/** Maximum element nesting converted structurally; deeper content is flattened to text. */
const MAX_CONVERSION_DEPTH = 256;

/** Raster image types copied verbatim, with the file extensions allowed for each. */
const RASTER_IMAGE_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map(
  [
    ["image/png", ["png"]],
    ["image/jpeg", ["jpg", "jpeg"]],
    ["image/jpg", ["jpg", "jpeg"]],
    ["image/gif", ["gif"]],
    ["image/webp", ["webp"]],
    ["image/avif", ["avif"]],
    ["image/bmp", ["bmp"]],
  ],
);

const MARKDOWN_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\\": "\\\\",
  "[": "\\[",
  "]": "\\]",
  "`": "\\`",
};

/**
 * Escapes decoded text for Markdown: HTML-significant characters become
 * character references and link/code syntax is backslash-escaped, so text can
 * never turn into raw HTML, links or autolinks.
 */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[&<>\\[\]`]/g, (ch) => MARKDOWN_ESCAPES[ch] ?? ch);
}

/**
 * Collapses line breaks, with the whitespace around them, into single spaces
 * for inline-only Markdown contexts. Split-based, because a single regex
 * matching whitespace around the breaks is quadratic on long blank runs.
 */
function singleLine(text: string): string {
  const parts = text.split(/[\r\n]+/);
  if (parts.length === 1) return text;
  const last = parts.length - 1;
  const kept: string[] = [];
  parts.forEach((part, index) => {
    const trimmed =
      index === 0
        ? part.trimEnd()
        : index === last
          ? part.trimStart()
          : part.trim();
    if (trimmed || index === 0 || index === last) kept.push(trimmed);
  });
  return kept.join(" ");
}

/** Length of the longest backtick run, without spreading a huge array. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    if (run.length > longest) longest = run.length;
  }
  return longest;
}

/** Blockquote and list nesting beyond this is flattened, not re-prefixed. */
const MAX_BLOCK_NESTING = 8;

/**
 * Encodes a link/image destination so it cannot break out of `( ... )`.
 */
function encodeMarkdownDestination(url: string): string {
  return url.replace(/&/g, "&amp;").replace(
    // eslint-disable-next-line no-control-regex
    /[\s()<>"'`\\[\]\u0000-\u001f\u007f]/g,
    (ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x80
        ? `%${code.toString(16).toUpperCase().padStart(2, "0")}`
        : encodeURIComponent(ch);
    },
  );
}

/** Inline code span whose fence is longer than any backtick run in the content. */
function codeSpan(content: string): string {
  const text = singleLine(content);
  if (!text.trim()) return "";
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Fenced code block whose fence cannot be closed by the content. */
function fencedCodeBlock(content: string): string {
  const fence = "`".repeat(Math.max(2, longestBacktickRun(content)) + 1);
  return `\n\n${fence}\n${content.replace(/^\n+|\n+$/g, "")}\n${fence}\n\n`;
}

/**
 * Emits a YAML double-quoted scalar. JSON string syntax is valid YAML; the
 * characters YAML does not accept literally are additionally escaped.
 */
function yamlString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Iteratively collects the text content of a subtree (stack-safe). */
function collectText(root: XmlNode): string {
  let text = "";
  const stack: XmlNode[] = [root];
  for (;;) {
    const node = stack.pop();
    if (node === undefined) return text;
    if (node.nodeType === 3 || node.nodeType === 4) {
      text += node.nodeValue ?? "";
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = (node.localName ?? node.nodeName).toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") continue;
    for (
      let child: XmlNode | null = node.lastChild;
      child;
      child = child.previousSibling
    ) {
      stack.push(child);
    }
  }
}

/** Linear tag stripper for markup that cannot be parsed at all. */
function stripTagsLinear(markup: string): string {
  let out = "";
  let index = 0;
  while (index < markup.length) {
    const open = markup.indexOf("<", index);
    if (open === -1) {
      out += markup.slice(index);
      break;
    }
    out += markup.slice(index, open);
    const close = markup.indexOf(">", open + 1);
    if (close === -1) {
      out += markup.slice(open);
      break;
    }
    out += " ";
    index = close + 1;
  }
  return out.replace(/\s+/g, " ").trim();
}

function sanitizeAssetName(rawName: string): string {
  return (
    rawName
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f<>:"/\\|?*()[\]\s`'&#%]/g, "_")
      .replace(/^\.+/, "_") || "image"
  );
}

class MarkdownConverter {
  private readonly assetDirName: string;
  private readonly resourceMap: Map<
    string,
    { href: string; bytes: Uint8Array; mediaType: string }
  >;
  private readonly warnings: string[] = [];
  readonly extractedAssets = new Map<string, Uint8Array>();
  private readonly assetNamesByHref = new Map<string, string | null>();
  private hasWarnedMathML = false;
  private hasWarnedRemoteImage = false;

  constructor(
    resources: NormalizedPublication["resources"],
    assetDirName: string = "assets",
  ) {
    this.assetDirName = assetDirName;
    this.resourceMap = new Map();
    for (const res of resources) {
      this.resourceMap.set(res.href, res);
      const base = res.href.split("/").pop();
      if (base && !this.resourceMap.has(base)) {
        this.resourceMap.set(base, res);
      }
    }
  }

  getWarnings(): readonly string[] {
    return this.warnings;
  }

  convertDocument(xhtml: string, sectionHref: string): string {
    const parser = new DOMParser({
      onError: (level: string, msg: unknown) => {
        if (level === "fatalError") {
          this.warnings.push(
            `XML parse warning in section '${sectionHref}': ${String(msg)}`,
          );
        }
      },
    });

    let doc: XmlDocument;
    try {
      doc = parser.parseFromString(xhtml, "application/xhtml+xml");
    } catch {
      // Fallback: plain, fully escaped text if XML is completely malformed
      return escapeMarkdownText(stripTagsLinear(xhtml));
    }

    const body = doc.getElementsByTagName("body")[0] || doc.documentElement;
    if (!body) return "";
    return this.convertNode(body as unknown as XmlNode, sectionHref, 0).trim();
  }

  private convertNode(
    node: XmlNode,
    sectionHref: string,
    depth: number,
  ): string {
    if (node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4) {
      return escapeMarkdownText(node.nodeValue || "");
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) {
      return "";
    }

    const el = node as unknown as XmlElement;
    const tag = (el.localName || el.tagName || "").toLowerCase();

    // Skip non-visible or script elements
    if (
      tag === "script" ||
      tag === "style" ||
      tag === "noscript" ||
      tag === "template" ||
      tag === "head"
    ) {
      return "";
    }

    if (depth > MAX_CONVERSION_DEPTH) {
      return escapeMarkdownText(singleLine(collectText(el)));
    }

    // Ruby handling: convert <ruby>基底<rt>ふりがな</rt></ruby> -> 基底（ふりがな）
    if (tag === "ruby") {
      return this.convertRuby(el);
    }

    // MathML handling: preserve markup, but only after the shared DOM sanitizer
    if (tag === "math") {
      if (!this.hasWarnedMathML) {
        this.warnings.push(
          "MathML notation preserved as inline XML in Markdown output; simple terminal or text viewers may display raw tags.",
        );
        this.hasWarnedMathML = true;
      }
      return singleLine(sanitizeXmlNode(el, { markdownSafeText: true }));
    }

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1]!, 10);
      const content = singleLine(
        this.convertChildren(el, sectionHref, depth),
      ).trim();
      return `\n\n${"#".repeat(level)} ${content}\n\n`;
    }

    // Paragraph
    if (tag === "p") {
      const content = this.convertChildren(el, sectionHref, depth).trim();
      return `\n\n${content}\n\n`;
    }

    // Horizontal rule
    if (tag === "hr") {
      return "\n\n---\n\n";
    }

    // Formatting
    if (tag === "strong" || tag === "b") {
      const content = singleLine(
        this.convertChildren(el, sectionHref, depth),
      ).trim();
      return content ? `**${content}**` : "";
    }

    if (tag === "em" || tag === "i") {
      const content = singleLine(
        this.convertChildren(el, sectionHref, depth),
      ).trim();
      return content ? `*${content}*` : "";
    }

    if (tag === "code") {
      return codeSpan(collectText(el));
    }

    if (tag === "pre") {
      return fencedCodeBlock(collectText(el));
    }

    if (tag === "blockquote") {
      const content = this.convertChildren(el, sectionHref, depth).trim();
      // Each level re-prefixes every line below it; past a few levels that
      // only multiplies output, so deeper quotes are emitted flat.
      if (blockNesting(el) > MAX_BLOCK_NESTING) return `\n\n${content}\n\n`;
      const quoted = content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }

    // Lists
    if (tag === "ul") {
      const items = this.convertListItems(el, false, sectionHref, depth);
      return `\n\n${items}\n\n`;
    }

    if (tag === "ol") {
      const items = this.convertListItems(el, true, sectionHref, depth);
      return `\n\n${items}\n\n`;
    }

    // Links: relative, fragment, http(s) and mailto only
    if (tag === "a") {
      const href = (el.getAttribute("href") || "").trim();
      const text = singleLine(
        this.convertChildren(el, sectionHref, depth),
      ).trim();
      const kind = href ? classifyUrl(href) : "empty";
      if (
        kind !== "relative" &&
        kind !== "fragment" &&
        kind !== "http" &&
        kind !== "mailto"
      ) {
        return text;
      }
      return `[${text || escapeMarkdownText(singleLine(href))}](${encodeMarkdownDestination(href)})`;
    }

    // Images
    if (tag === "img") {
      return this.convertImage(el, sectionHref);
    }

    // Tables
    if (tag === "table") {
      return this.convertTable(el, sectionHref, depth);
    }

    // Containers (div, section, article, span, etc.)
    return this.convertChildren(el, sectionHref, depth);
  }

  private convertChildren(
    el: XmlElement,
    sectionHref: string,
    depth: number,
  ): string {
    let result = "";
    const children = el.childNodes as unknown as XmlNode[];
    for (let i = 0; i < children.length; i += 1) {
      result += this.convertNode(children[i]!, sectionHref, depth + 1);
    }
    return result;
  }

  private convertRuby(rubyEl: XmlElement): string {
    // E.g.: <ruby>夏目<rt>なつめ</rt>漱石<rt>そうせき</rt></ruby>
    // or <ruby>吾輩<rp>(</rp><rt>わがはい</rt><rp>)</rp></ruby>
    let output = "";
    let currentBase = "";

    const children = rubyEl.childNodes as unknown as XmlNode[];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (child.nodeType === 3 || child.nodeType === 4) {
        currentBase += child.nodeValue || "";
      } else if (child.nodeType === 1) {
        const childEl = child as unknown as XmlElement;
        const childTag = (childEl.localName || "").toLowerCase();
        if (childTag === "rt") {
          const reading = collectText(childEl).trim();
          output += `${currentBase}（${reading}）`;
          currentBase = "";
        } else if (childTag === "rp") {
          // ignore rp parentheses to avoid doubling
          continue;
        } else {
          currentBase += collectText(childEl);
        }
      }
    }

    if (currentBase) {
      output += currentBase;
    }

    return escapeMarkdownText(singleLine(output || collectText(rubyEl)));
  }

  private convertImage(imgEl: XmlElement, sectionHref: string): string {
    const src = (imgEl.getAttribute("src") || "").trim();
    const alt = escapeMarkdownText(singleLine(imgEl.getAttribute("alt") || ""));

    if (!src) return "";

    const kind = classifyUrl(src);
    const res =
      kind === "relative"
        ? this.resourceMap.get(resolveRelativePath(sectionHref, src)) ||
          this.resourceMap.get(src) ||
          this.resourceMap.get(src.split("/").pop() || "")
        : undefined;

    const assetName = res ? this.extractAsset(res) : undefined;
    if (assetName) {
      const relativeAssetPath = `${this.assetDirName}/${assetName}`;
      return `![${alt}](${encodeMarkdownDestination(relativeAssetPath)})`;
    }

    // Non-local (remote, data:, script) or unusable images are dropped.
    if (!this.hasWarnedRemoteImage) {
      this.warnings.push(
        "Images that are not local raster/SVG publication resources were omitted from the Markdown output.",
      );
      this.hasWarnedRemoteImage = true;
    }
    return alt;
  }

  /**
   * Copies an image resource into the asset map. Only raster images (with a
   * matching extension) and sanitized SVG are written, so a published asset
   * directory can never contain attacker-chosen HTML/script files.
   */
  private extractAsset(res: {
    href: string;
    bytes: Uint8Array;
    mediaType: string;
  }): string | undefined {
    const cached = this.assetNamesByHref.get(res.href);
    if (cached !== undefined) return cached ?? undefined;

    const mediaType = res.mediaType.trim().toLowerCase();
    const rawName = res.href.split("/").pop() || "image";
    let name = sanitizeAssetName(rawName);
    let bytes: Uint8Array | undefined;

    const rasterExtensions = RASTER_IMAGE_EXTENSIONS.get(mediaType);
    if (rasterExtensions) {
      const ext = name.includes(".")
        ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
        : "";
      if (!rasterExtensions.includes(ext)) {
        name = `${name}.${rasterExtensions[0]}`;
      }
      bytes = res.bytes;
    } else if (mediaType === "image/svg+xml") {
      const sanitizedSvg = sanitizeSvgDocument(
        new TextDecoder("utf-8").decode(res.bytes),
      );
      if (sanitizedSvg !== undefined) {
        if (!name.toLowerCase().endsWith(".svg")) name = `${name}.svg`;
        bytes = new TextEncoder().encode(sanitizedSvg);
      }
    }

    if (!bytes) {
      this.assetNamesByHref.set(res.href, null);
      return undefined;
    }

    // Avoid silently overwriting a different asset with the same basename.
    let uniqueName = name;
    for (let n = 1; this.extractedAssets.has(uniqueName); n += 1) {
      const dot = name.lastIndexOf(".");
      uniqueName =
        dot > 0
          ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
          : `${name}-${n}`;
    }
    this.extractedAssets.set(uniqueName, bytes);
    this.assetNamesByHref.set(res.href, uniqueName);
    return uniqueName;
  }

  private convertListItems(
    listEl: XmlElement,
    isOrdered: boolean,
    sectionHref: string,
    depth: number,
  ): string {
    const lines: string[] = [];
    let count = 1;
    const children = listEl.childNodes as unknown as XmlNode[];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (
        child.nodeType === 1 &&
        ((child as unknown as XmlElement).localName || "").toLowerCase() ===
          "li"
      ) {
        const text = this.convertChildren(
          child as unknown as XmlElement,
          sectionHref,
          depth + 1,
        ).trim();
        const marker = isOrdered ? `${count}. ` : "- ";
        if (isOrdered) count += 1;
        // Indent continuation lines so nested blocks stay inside the item
        // (up to a nesting limit, beyond which items stay flat).
        const indent =
          blockNesting(listEl) > MAX_BLOCK_NESTING
            ? ""
            : " ".repeat(marker.length);
        const [first = "", ...rest] = text.split("\n");
        lines.push(
          [
            `${marker}${first}`,
            ...rest.map((line) => (line ? `${indent}${line}` : line)),
          ].join("\n"),
        );
      }
    }
    return lines.join("\n");
  }

  private convertTable(
    tableEl: XmlElement,
    sectionHref: string,
    depth: number,
  ): string {
    // Only this table's own rows: getElementsByTagName would also return the
    // rows of nested tables and convert them again at every level.
    const rows = ownTableRows(tableEl);
    if (rows.length === 0) return "";

    const matrix: string[][] = [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r]!;
      const rowCells: string[] = [];
      const cells = row.childNodes as unknown as XmlNode[];
      for (let c = 0; c < cells.length; c += 1) {
        const cell = cells[c]!;
        if (cell.nodeType === 1) {
          const tag = (
            (cell as unknown as XmlElement).localName || ""
          ).toLowerCase();
          if (tag === "td" || tag === "th") {
            const text = singleLine(
              this.convertChildren(
                cell as unknown as XmlElement,
                sectionHref,
                depth + 1,
              ),
            )
              .replace(/\|/g, "\\|")
              .trim();
            rowCells.push(text);
          }
        }
      }
      if (rowCells.length > 0) {
        matrix.push(rowCells);
      }
    }

    if (matrix.length === 0) return "";

    // Determine max columns
    let colCount = 0;
    for (const row of matrix) colCount = Math.max(colCount, row.length);
    const headerRow = matrix[0]!;
    while (headerRow.length < colCount) {
      headerRow.push("");
    }

    const separatorRow = new Array(colCount).fill("---");
    const outLines: string[] = [
      `| ${headerRow.join(" | ")} |`,
      `| ${separatorRow.join(" | ")} |`,
    ];

    for (let r = 1; r < matrix.length; r += 1) {
      const row = matrix[r]!;
      while (row.length < colCount) {
        row.push("");
      }
      outLines.push(`| ${row.join(" | ")} |`);
    }

    return `\n\n${outLines.join("\n")}\n\n`;
  }
}

/**
 * Exports a NormalizedPublication into GFM-compliant Markdown with a companion asset Map.
 */
export function exportToMarkdown(
  publication: NormalizedPublication,
  options?: MarkdownExportOptions,
): MarkdownExportResult {
  const assetDirName = options?.assetDirectoryName ?? "assets";
  const converter = new MarkdownConverter(publication.resources, assetDirName);

  const docTitle = publication.metadata.title || "Untitled Publication";
  const docLang = publication.metadata.language || "ja";
  const docAuthor =
    typeof publication.metadata.creator === "string"
      ? publication.metadata.creator
      : Array.isArray(publication.metadata.creator)
        ? publication.metadata.creator.join(", ")
        : "";

  const titleMd = escapeMarkdownText(singleLine(docTitle)).trim();
  const authorMd = escapeMarkdownText(singleLine(docAuthor)).trim();

  const frontmatter = `---
title: ${yamlString(docTitle)}
author: ${yamlString(docAuthor)}
language: ${yamlString(docLang)}
generator: "ReflowPress Export Workbench"
---

# ${titleMd}
${authorMd ? `\n*${authorMd}*\n` : ""}
`;

  const sectionMarkdownParts: string[] = [];
  for (const section of publication.readingOrder) {
    const sectionMd = converter.convertDocument(section.markup, section.href);
    if (sectionMd) {
      sectionMarkdownParts.push(sectionMd);
    }
  }

  // Combine and clean up excess whitespace
  let fullMarkdown =
    frontmatter + "\n\n" + sectionMarkdownParts.join("\n\n---\n\n");
  fullMarkdown = fullMarkdown.replace(/\n{3,}/g, "\n\n").trim() + "\n";

  return {
    markdown: fullMarkdown,
    assets: converter.extractedAssets,
    warnings: converter.getWarnings(),
  };
}

function elementName(node: XmlNode): string {
  return node.nodeType === 1
    ? ((node as unknown as XmlElement).localName || "").toLowerCase()
    : "";
}

/** Rows that belong to this table, directly or through thead/tbody/tfoot. */
function ownTableRows(tableEl: XmlElement): XmlElement[] {
  const rows: XmlElement[] = [];
  const children = tableEl.childNodes as unknown as XmlNode[];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    const name = elementName(child);
    if (name === "tr") {
      rows.push(child as unknown as XmlElement);
    } else if (name === "thead" || name === "tbody" || name === "tfoot") {
      const sectionRows = child.childNodes as unknown as XmlNode[];
      for (let j = 0; j < sectionRows.length; j += 1) {
        if (elementName(sectionRows[j]!) === "tr") {
          rows.push(sectionRows[j] as unknown as XmlElement);
        }
      }
    }
  }
  return rows;
}

/** Number of blockquote and list elements enclosing (and including) `el`. */
function blockNesting(el: XmlElement): number {
  let count = 0;
  for (
    let node: XmlNode | null = el;
    node;
    node = node.parentNode as XmlNode | null
  ) {
    const name = elementName(node);
    if (name === "blockquote" || name === "ul" || name === "ol") count += 1;
  }
  return count;
}
