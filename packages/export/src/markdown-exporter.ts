import type { NormalizedPublication } from "@reflowpress/core";
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";

export interface MarkdownExportOptions {
  readonly assetDirectoryName?: string | undefined;
}

export interface MarkdownExportResult {
  readonly markdown: string;
  readonly assets: Map<string, Uint8Array>;
  readonly warnings: readonly string[];
}

function resolveRelativePath(baseHref: string, relativeHref: string): string {
  if (relativeHref.startsWith("/")) {
    return relativeHref.slice(1);
  }
  const parts = baseHref.split("/");
  parts.pop();
  const segs = relativeHref.split("/");
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

class MarkdownConverter {
  private readonly assetDirName: string;
  private readonly resourceMap: Map<
    string,
    { href: string; bytes: Uint8Array; mediaType: string }
  >;
  private readonly warnings: string[] = [];
  readonly extractedAssets = new Map<string, Uint8Array>();
  private hasWarnedMathML = false;

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
      errorHandler: (level: string, msg: unknown) => {
        if (level === "fatalError") {
          this.warnings.push(
            `XML parse warning in section '${sectionHref}': ${String(msg)}`,
          );
        }
      },
    });

    let doc: XmlDocument;
    try {
      doc = parser.parseFromString(xhtml, "text/xml");
    } catch {
      // Fallback plain regex stripping if XML is completely malformed
      return xhtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const body = doc.getElementsByTagName("body")[0] || doc.documentElement;
    return this.convertNode(body as unknown as XmlNode, sectionHref).trim();
  }

  private convertNode(node: XmlNode, sectionHref: string): string {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      return node.nodeValue || "";
    }

    if (node.nodeType !== 1 /* ELEMENT_NODE */) {
      return "";
    }

    const el = node as unknown as XmlElement;
    const tag = (el.tagName || "").toLowerCase();

    // Skip non-visible or script elements
    if (tag === "script" || tag === "style" || tag === "noscript") {
      return "";
    }

    // Ruby handling: convert <ruby>基底<rt>ふりがな</rt></ruby> -> 基底（ふりがな）
    if (tag === "ruby") {
      return this.convertRuby(el);
    }

    // MathML handling: preserve raw markup with warning
    if (tag === "math") {
      if (!this.hasWarnedMathML) {
        this.warnings.push(
          "MathML notation preserved as inline XML in Markdown output; simple terminal or text viewers may display raw tags.",
        );
        this.hasWarnedMathML = true;
      }
      return el.toString();
    }

    // Headings
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1]!, 10);
      const content = this.convertChildren(el, sectionHref).trim();
      return `\n\n${"#".repeat(level)} ${content}\n\n`;
    }

    // Paragraph
    if (tag === "p") {
      const content = this.convertChildren(el, sectionHref).trim();
      return `\n\n${content}\n\n`;
    }

    // Horizontal rule
    if (tag === "hr") {
      return "\n\n---\n\n";
    }

    // Formatting
    if (tag === "strong" || tag === "b") {
      const content = this.convertChildren(el, sectionHref).trim();
      return content ? `**${content}**` : "";
    }

    if (tag === "em" || tag === "i") {
      const content = this.convertChildren(el, sectionHref).trim();
      return content ? `*${content}*` : "";
    }

    if (tag === "code") {
      const content = el.textContent || "";
      if (
        el.parentNode &&
        (
          (el.parentNode as unknown as XmlElement).tagName || ""
        ).toLowerCase() === "pre"
      ) {
        return content;
      }
      return `\`${content}\``;
    }

    if (tag === "pre") {
      const content = el.textContent || "";
      return `\n\n\`\`\`\n${content.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`;
    }

    if (tag === "blockquote") {
      const content = this.convertChildren(el, sectionHref).trim();
      const quoted = content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }

    // Lists
    if (tag === "ul") {
      const items = this.convertListItems(el, false, sectionHref);
      return `\n\n${items}\n\n`;
    }

    if (tag === "ol") {
      const items = this.convertListItems(el, true, sectionHref);
      return `\n\n${items}\n\n`;
    }

    // Links
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      const text = this.convertChildren(el, sectionHref).trim();
      if (!href || href.startsWith("javascript:")) {
        return text;
      }
      return `[${text || href}](${href})`;
    }

    // Images
    if (tag === "img") {
      return this.convertImage(el, sectionHref);
    }

    // Tables
    if (tag === "table") {
      return this.convertTable(el, sectionHref);
    }

    // Containers (div, section, article, span, etc.)
    return this.convertChildren(el, sectionHref);
  }

  private convertChildren(el: XmlElement, sectionHref: string): string {
    let result = "";
    const children = el.childNodes as unknown as XmlNode[];
    for (let i = 0; i < children.length; i += 1) {
      result += this.convertNode(children[i]!, sectionHref);
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
      if (child.nodeType === 3) {
        currentBase += child.nodeValue || "";
      } else if (child.nodeType === 1) {
        const childEl = child as unknown as XmlElement;
        const childTag = (childEl.tagName || "").toLowerCase();
        if (childTag === "rt") {
          const reading = (childEl.textContent || "").trim();
          output += `${currentBase}（${reading}）`;
          currentBase = "";
        } else if (childTag === "rp") {
          // ignore rp parentheses to avoid doubling
          continue;
        } else {
          currentBase += childEl.textContent || "";
        }
      }
    }

    if (currentBase) {
      output += currentBase;
    }

    return output || rubyEl.textContent || "";
  }

  private convertImage(imgEl: XmlElement, sectionHref: string): string {
    const src = imgEl.getAttribute("src") || "";
    const alt = imgEl.getAttribute("alt") || "";

    if (!src) return "";

    const resolved = resolveRelativePath(sectionHref, src);
    const res =
      this.resourceMap.get(resolved) ||
      this.resourceMap.get(src) ||
      this.resourceMap.get(src.split("/").pop() || "");

    if (res) {
      const rawName = res.href.split("/").pop() || "image.png";
      // eslint-disable-next-line no-control-regex
      const safeName = rawName.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_");
      const relativeAssetPath = `${this.assetDirName}/${safeName}`;
      this.extractedAssets.set(safeName, res.bytes);
      return `![${alt}](${relativeAssetPath})`;
    }

    // Keep external or unmapped URL
    return `![${alt}](${src})`;
  }

  private convertListItems(
    listEl: XmlElement,
    isOrdered: boolean,
    sectionHref: string,
  ): string {
    const lines: string[] = [];
    let count = 1;
    const children = listEl.childNodes as unknown as XmlNode[];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]!;
      if (
        child.nodeType === 1 &&
        ((child as unknown as XmlElement).tagName || "").toLowerCase() === "li"
      ) {
        const text = this.convertChildren(
          child as unknown as XmlElement,
          sectionHref,
        ).trim();
        if (isOrdered) {
          lines.push(`${count}. ${text}`);
          count += 1;
        } else {
          lines.push(`- ${text}`);
        }
      }
    }
    return lines.join("\n");
  }

  private convertTable(tableEl: XmlElement, sectionHref: string): string {
    const rows = tableEl.getElementsByTagName("tr") as unknown as XmlElement[];
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
            (cell as unknown as XmlElement).tagName || ""
          ).toLowerCase();
          if (tag === "td" || tag === "th") {
            const text = this.convertChildren(
              cell as unknown as XmlElement,
              sectionHref,
            )
              .replace(/[\n\r]+/g, " ")
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
    const colCount = Math.max(...matrix.map((r) => r.length));
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

  const frontmatter = `---
title: "${docTitle.replace(/"/g, '\\"')}"
author: "${docAuthor.replace(/"/g, '\\"')}"
language: "${docLang}"
generator: "ReflowPress Export Workbench"
---

# ${docTitle}
${docAuthor ? `\n*${docAuthor}*\n` : ""}
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
