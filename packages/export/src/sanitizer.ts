import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";
import type {
  NormalizedPublication,
  PublicationResource,
} from "@reflowpress/core";
import { normalizeLegacyEpubCss } from "@reflowpress/typography";

/**
 * Shared, DOM-based allowlist sanitizer for every export path (standalone HTML,
 * Markdown MathML islands and the Chromium PDF renderer).
 *
 * Threat model: publication markup and stylesheets are attacker controlled. The
 * sanitizer parses section XHTML with @xmldom/xmldom, walks the tree iteratively
 * and re-serializes only allowlisted elements/attributes with full escaping, so the
 * output can be embedded into an HTML document without script execution or
 * network access.
 */

/** Maximum asset bytes inlined as data: URLs (counted per inlined occurrence). */
export const DEFAULT_MAX_INLINE_ASSET_BYTES = 16 * 1024 * 1024;

/** Content-Security-Policy applied to exported standalone documents. */
export const EXPORT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";

const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;
const ELEMENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;
const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes a string for use as HTML text or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// URL classification
// ---------------------------------------------------------------------------

export type UrlKind =
  | "empty"
  | "fragment"
  | "relative"
  | "network-path"
  | "data-image"
  | "data"
  | "http"
  | "mailto"
  | "other-scheme";

const NAMED_CHARACTER_REFERENCES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["colon", ":"],
  ["tab", "\t"],
  ["newline", "\n"],
  ["nbsp", "\u00a0"],
  ["sol", "/"],
  ["bsol", "\\"],
  ["num", "#"],
  ["period", "."],
  ["lpar", "("],
  ["rpar", ")"],
]);

function codePointToString(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
    return "\ufffd";
  }
  return String.fromCodePoint(codePoint);
}

/**
 * Decodes character references once more (the DOM already decoded one level).
 * Used only for scheme checks, so over-decoding can only make checks stricter.
 */
function decodeCharacterReferences(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,8})|#([0-9]{1,10})|([a-zA-Z]{2,10}));?/g,
    (match, hex: string | undefined, dec: string | undefined, name) => {
      if (hex !== undefined) return codePointToString(parseInt(hex, 16));
      if (dec !== undefined) return codePointToString(parseInt(dec, 10));
      return (
        NAMED_CHARACTER_REFERENCES.get(String(name).toLowerCase()) ?? match
      );
    },
  );
}

/**
 * Classifies a URL the way a browser would resolve its scheme: character
 * references are decoded, all whitespace / control / invisible characters are
 * removed and the result is lowercased before the scheme check.
 */
export function classifyUrl(value: string): UrlKind {
  const normalized = decodeCharacterReferences(value)
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\s\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]+/g,
      "",
    )
    .toLowerCase();

  if (normalized === "") return "empty";
  if (normalized.startsWith("#")) return "fragment";
  // Scheme-relative ("network-path") references, including the backslash
  // variants that browsers treat as slashes.
  if (/^[\\/]{2}/.test(normalized)) return "network-path";

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!schemeMatch) return "relative";

  const scheme = schemeMatch[1];
  if (scheme === "data") {
    return normalized.startsWith("data:image/") ? "data-image" : "data";
  }
  if (scheme === "http" || scheme === "https") return "http";
  if (scheme === "mailto") return "mailto";
  return "other-scheme";
}

// ---------------------------------------------------------------------------
// CSS sanitization
// ---------------------------------------------------------------------------

const SAFE_CSS_URL_KINDS: ReadonlySet<UrlKind> = new Set<UrlKind>([
  "empty",
  "fragment",
  "relative",
  "data-image",
]);

const DANGEROUS_CSS_PATTERN =
  /expression\s*\(|javascript:|vbscript:|livescript:|-moz-binding|(?:^|[^a-z0-9-])behavior\s*:|@import|image-set\s*\(|cross-fade\s*\(|(?:^|[^a-z0-9-])image\s*\(|(?:^|[^a-z0-9-])src\s*\(/;

function decodeCssEscapes(css: string): string {
  if (!css.includes("\\")) return css;
  return css.replace(
    /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_match, hex: string | undefined, newline: string | undefined, ch) => {
      if (hex !== undefined) return codePointToString(parseInt(hex, 16));
      if (newline !== undefined) return "";
      return String(ch);
    },
  );
}

/** Returns the index just after a CSS string starting at `start`. */
function skipCssString(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const ch = css[index];
    if (ch === "\\") {
      index += 2;
    } else if (ch === quote) {
      return index + 1;
    } else if (ch === "\n" || ch === "\r" || ch === "\f") {
      // An unescaped newline terminates a (bad) string.
      return index;
    } else {
      index += 1;
    }
  }
  return css.length;
}

/** Removes comments while respecting string boundaries (linear). */
function stripCssComments(css: string): string {
  let out = "";
  let segmentStart = 0;
  let index = 0;
  while (index < css.length) {
    const ch = css[index];
    if (ch === "/" && css[index + 1] === "*") {
      out += css.slice(segmentStart, index);
      const end = css.indexOf("*/", index + 2);
      index = end === -1 ? css.length : end + 2;
      segmentStart = index;
    } else if (ch === '"' || ch === "'") {
      index = skipCssString(css, index);
    } else if (ch === "\\") {
      index += 2;
    } else {
      index += 1;
    }
  }
  return out + css.slice(segmentStart);
}

function stripCssQuotes(value: string): string {
  return value.replace(/^\s*['"]?/, "").replace(/['"]?\s*$/, "");
}

/**
 * Checks CSS text (a stylesheet or a style attribute) after decoding escapes and
 * dropping comments: no script-ish constructs, no @import, and every url()
 * target must be relative, a fragment or a data:image URL.
 */
function isSafeCss(css: string): boolean {
  const flattened = decodeCssEscapes(stripCssComments(css)).toLowerCase();
  if (DANGEROUS_CSS_PATTERN.test(flattened)) return false;

  let index = 0;
  for (;;) {
    const start = flattened.indexOf("url(", index);
    if (start === -1) return true;
    const end = flattened.indexOf(")", start + 4);
    if (end === -1) return false;
    const target = stripCssQuotes(flattened.slice(start + 4, end));
    if (!SAFE_CSS_URL_KINDS.has(classifyUrl(target))) return false;
    index = end + 1;
  }
}

function startsWithIgnoreCase(
  source: string,
  index: number,
  needle: string,
): boolean {
  return (
    source.slice(index, index + needle.length).toLowerCase() ===
    needle.toLowerCase()
  );
}

/** Finds the `)` closing a url( token whose argument starts at `start`. */
function findCssUrlEnd(css: string, start: number): number {
  let index = start;
  while (index < css.length && /\s/.test(css[index] ?? "")) index += 1;
  if (css[index] === '"' || css[index] === "'") {
    index = skipCssString(css, index);
    const close = css.indexOf(")", index);
    return close;
  }
  while (index < css.length) {
    const ch = css[index];
    if (ch === "\\") {
      index += 2;
    } else if (ch === ")") {
      return index;
    } else {
      index += 1;
    }
  }
  return -1;
}

/**
 * Rewrites plain (non-obfuscated) unsafe constructs: drops @import rules and
 * replaces url() tokens whose target is not relative/fragment/data:image with
 * `none` (which invalidates or neutralizes the declaration).
 */
function rewriteCss(css: string): string {
  let out = "";
  let segmentStart = 0;
  let index = 0;
  while (index < css.length) {
    const ch = css[index];
    if (ch === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      index = end === -1 ? css.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      index = skipCssString(css, index);
    } else if (ch === "\\") {
      index += 2;
    } else if (ch === "@" && startsWithIgnoreCase(css, index + 1, "import")) {
      out += css.slice(segmentStart, index);
      let cursor = index + 7;
      while (cursor < css.length && css[cursor] !== ";") {
        const c = css[cursor];
        if (c === '"' || c === "'") cursor = skipCssString(css, cursor);
        else if (c === "\\") cursor += 2;
        else cursor += 1;
      }
      index = Math.min(css.length, cursor + 1);
      segmentStart = index;
    } else if (
      (ch === "u" || ch === "U") &&
      startsWithIgnoreCase(css, index, "url(")
    ) {
      const argStart = index + 4;
      const end = findCssUrlEnd(css, argStart);
      if (end === -1) {
        // Unterminated url(): drop the remainder of the stylesheet.
        out += css.slice(segmentStart, index);
        segmentStart = css.length;
        break;
      }
      const target = decodeCssEscapes(stripCssQuotes(css.slice(argStart, end)));
      if (!SAFE_CSS_URL_KINDS.has(classifyUrl(target))) {
        out += `${css.slice(segmentStart, index)}none`;
        segmentStart = end + 1;
      }
      index = end + 1;
    } else {
      index += 1;
    }
  }
  return out + css.slice(segmentStart);
}

/**
 * Neutralizes every `<` so that CSS can never terminate a surrounding
 * `<style>` element (`</style`), regardless of case or whitespace.
 * `\3c ` is the CSS escape for `<`, so strings/urls keep their meaning.
 */
export function neutralizeStyleText(css: string): string {
  return css.replace(/</g, "\\3c ");
}

export interface StylesheetSanitizeResult {
  readonly css: string;
  /** True when the stylesheet contained obfuscated unsafe constructs and was dropped. */
  readonly dropped: boolean;
}

/**
 * Sanitizes an EPUB stylesheet for embedding in a `<style>` element: removes
 * @import rules, replaces remote/script url() targets, rejects script-ish
 * constructs and neutralizes `</style` breakouts.
 */
export function sanitizeStylesheet(css: string): StylesheetSanitizeResult {
  const rewritten = rewriteCss(css);
  if (!isSafeCss(rewritten)) {
    return { css: "", dropped: true };
  }
  return { css: neutralizeStyleText(rewritten), dropped: false };
}

// ---------------------------------------------------------------------------
// Element / attribute policy
// ---------------------------------------------------------------------------

/** Elements removed together with their entire subtree (any namespace). */
const DROP_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "param",
  "meta",
  "base",
  "link",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "datalist",
  "keygen",
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
  "animatecolor",
  "discard",
  "mpath",
  "foreignobject",
  "noscript",
  "template",
  "noembed",
  "noframes",
  "plaintext",
  "xmp",
  "portal",
  "fencedframe",
  "head",
  "annotation-xml",
  "handler",
  "listener",
  "slot",
  "metadata",
]);

const HTML_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "acronym",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "menu",
  "meter",
  "nav",
  "nobr",
  "ol",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rb",
  "rp",
  "rt",
  "rtc",
  "ruby",
  "s",
  "samp",
  "search",
  "section",
  "small",
  "source",
  "span",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "tt",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "br",
  "col",
  "hr",
  "img",
  "source",
  "track",
  "wbr",
]);

const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "a",
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "feimage",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
  "filter",
  "g",
  "image",
  "line",
  "lineargradient",
  "marker",
  "mask",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "switch",
  "symbol",
  "text",
  "textpath",
  "title",
  "tspan",
  "use",
  "view",
]);

const MATHML_ELEMENTS: ReadonlySet<string> = new Set([
  "math",
  "annotation",
  "menclose",
  "merror",
  "mfenced",
  "mfrac",
  "mi",
  "mlabeledtr",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
]);

/** Attributes removed regardless of value. */
const DROP_ATTRIBUTES: ReadonlySet<string> = new Set([
  "srcdoc",
  "http-equiv",
  "action",
  "formaction",
  "srcset",
  "imagesrcset",
  "ping",
  "lowsrc",
  "dynsrc",
  "codebase",
  "classid",
  "archive",
  "manifest",
  "profile",
  "is",
  "nonce",
  "integrity",
  "base",
]);

/** URL-bearing attributes subject to the URL allowlist. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "href",
  "src",
  "poster",
  "data",
  "background",
  "cite",
  "longdesc",
  "usemap",
  "icon",
]);

type SanitizeContext = "html" | "svg" | "math";

export interface XhtmlSanitizeOptions {
  /**
   * Resolves a relative image reference (img src, SVG image href, poster) into
   * an inline data: URL. Returning undefined keeps the relative reference.
   */
  readonly resolveImage?:
    ((reference: string) => string | undefined) | undefined;
  /** Receives non-fatal sanitizer warnings. */
  readonly onWarning?: ((message: string) => void) | undefined;
  /** Section href used in warning messages. */
  readonly sectionHref?: string | undefined;
  /**
   * Additionally encodes Markdown metacharacters in text as character
   * references, for HTML islands embedded in Markdown (where text between
   * inline tags is still parsed as Markdown).
   */
  readonly markdownSafeText?: boolean | undefined;
}

interface SerializerSettings extends XhtmlSanitizeOptions {
  /** Emit well-formed standalone XML (drops attributes with unbound prefixes). */
  readonly xmlCompatible?: boolean | undefined;
}

const MARKDOWN_TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "[": "&#91;",
  "]": "&#93;",
  "\\": "&#92;",
  "`": "&#96;",
  "*": "&#42;",
  _: "&#95;",
  "~": "&#126;",
  "|": "&#124;",
};

function escapeMarkdownSafeText(value: string): string {
  return value.replace(
    /[&<>[\]\\`*_~|]/g,
    (ch) => MARKDOWN_TEXT_ESCAPES[ch] ?? ch,
  );
}

type WorkItem =
  | string
  | {
      readonly node: XmlNode;
      readonly context: SanitizeContext;
      readonly textOnly: boolean;
    };

/**
 * Iterative (stack based) serializer: safe for arbitrarily deep trees.
 */
class AllowlistSerializer {
  private readonly out: string[] = [];
  private readonly stack: WorkItem[] = [];

  private readonly escapeTextNode: (value: string) => string;

  constructor(private readonly options: SerializerSettings) {
    this.escapeTextNode = options.markdownSafeText
      ? escapeMarkdownSafeText
      : escapeText;
  }

  serializeChildren(parent: XmlNode, context: SanitizeContext): string {
    this.pushChildren(parent, context, false);
    this.run();
    return this.out.join("");
  }

  serializeNode(node: XmlNode, context: SanitizeContext): string {
    this.stack.push({ node, context, textOnly: false });
    this.run();
    return this.out.join("");
  }

  private pushChildren(
    parent: XmlNode,
    context: SanitizeContext,
    textOnly: boolean,
  ): void {
    for (
      let child: XmlNode | null = parent.lastChild;
      child;
      child = child.previousSibling
    ) {
      this.stack.push({ node: child, context, textOnly });
    }
  }

  private run(): void {
    for (;;) {
      const item = this.stack.pop();
      if (item === undefined) return;
      if (typeof item === "string") {
        this.out.push(item);
        continue;
      }
      const { node, context, textOnly } = item;
      if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
        this.out.push(this.escapeTextNode(node.nodeValue ?? ""));
      } else if (node.nodeType === ELEMENT_NODE) {
        this.visitElement(node as XmlElement, context, textOnly);
      }
      // Comments, processing instructions, doctypes, etc. are dropped.
    }
  }

  private visitElement(
    element: XmlElement,
    context: SanitizeContext,
    textOnly: boolean,
  ): void {
    const localName = element.localName ?? element.nodeName;
    const lower = localName.toLowerCase();

    if (DROP_ELEMENTS.has(lower)) return;

    if (lower === "style") {
      if (context === "svg" && !textOnly) this.emitSvgStyle(element);
      return;
    }
    if (lower === "title" && context !== "svg") return;

    if (textOnly || !ELEMENT_NAME_PATTERN.test(localName)) {
      this.pushChildren(element, context, textOnly);
      return;
    }

    let elementContext: SanitizeContext = context;
    let allowed: boolean;
    if (context === "html") {
      if (lower === "svg") {
        allowed = true;
        elementContext = "svg";
      } else if (lower === "math") {
        allowed = true;
        elementContext = "math";
      } else {
        allowed = HTML_ELEMENTS.has(lower);
      }
    } else if (context === "svg") {
      allowed = SVG_ELEMENTS.has(lower);
    } else {
      allowed = MATHML_ELEMENTS.has(lower);
    }

    if (!allowed) {
      // Unwrap: drop the element itself but keep its (sanitized) content.
      this.pushChildren(element, context, false);
      return;
    }

    const tagName = elementContext === "html" ? lower : localName;
    const attributes = this.serializeAttributes(element, lower, elementContext);
    this.out.push(`<${tagName}${attributes}>`);

    if (elementContext === "html" && HTML_VOID_ELEMENTS.has(lower)) return;

    // SVG <title>/<desc> are HTML integration points: keep text only.
    const childTextOnly =
      elementContext === "svg" && (lower === "title" || lower === "desc");
    this.stack.push(`</${tagName}>`);
    this.pushChildren(element, elementContext, childTextOnly);
  }

  private emitSvgStyle(element: XmlElement): void {
    let css = "";
    for (
      let child: XmlNode | null = element.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (
        child.nodeType === TEXT_NODE ||
        child.nodeType === CDATA_SECTION_NODE
      ) {
        css += child.nodeValue ?? "";
      }
    }
    const result = sanitizeStylesheet(css);
    if (result.dropped) {
      this.warn(
        "An embedded SVG stylesheet contained unsafe constructs and was removed.",
      );
      return;
    }
    this.out.push(`<style>${this.escapeTextNode(result.css)}</style>`);
  }

  private serializeAttributes(
    element: XmlElement,
    elementName: string,
    context: SanitizeContext,
  ): string {
    let out = "";
    const emitted = new Set<string>();
    const attributes = element.attributes;
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes.item(index);
      if (!attribute) continue;

      const qualifiedName = attribute.name;
      if (!ATTRIBUTE_NAME_PATTERN.test(qualifiedName)) continue;
      const lowerQualified = qualifiedName.toLowerCase();
      const local = (attribute.localName ?? qualifiedName).toLowerCase();
      const namespace = attribute.namespaceURI;

      if (
        lowerQualified === "xmlns" ||
        lowerQualified.startsWith("xmlns:") ||
        namespace === XMLNS_NS
      ) {
        continue;
      }
      if (local.startsWith("on") || lowerQualified.startsWith("on")) continue;
      if (DROP_ATTRIBUTES.has(local) || DROP_ATTRIBUTES.has(lowerQualified)) {
        continue;
      }

      let value: string | undefined = attribute.value;
      if (local === "style") {
        if (!isSafeCss(value)) continue;
      } else if (URL_ATTRIBUTES.has(local)) {
        value = this.sanitizeUrlAttribute(elementName, context, local, value);
        if (value === undefined) continue;
      } else if (/url\s*\(|\\/i.test(value) && !isSafeCss(value)) {
        // e.g. SVG presentation attributes such as fill="url(http://...)"
        continue;
      }

      let outputName = qualifiedName;
      if (namespace === XLINK_NS) {
        outputName = `xlink:${attribute.localName ?? local}`;
      } else if (namespace === XML_NS) {
        outputName = `xml:${attribute.localName ?? local}`;
      } else if (this.options.xmlCompatible && qualifiedName.includes(":")) {
        // Unbound prefixes would make a standalone XML document ill-formed.
        continue;
      }
      if (emitted.has(outputName)) continue;
      emitted.add(outputName);
      out += ` ${outputName}="${escapeHtml(value)}"`;
    }
    return out;
  }

  private sanitizeUrlAttribute(
    elementName: string,
    context: SanitizeContext,
    attributeName: string,
    value: string,
  ): string | undefined {
    const kind = classifyUrl(value);

    if (attributeName === "href") {
      if (
        context === "svg" &&
        (elementName === "image" || elementName === "feimage")
      ) {
        return this.sanitizeImageUrl(value, kind);
      }
      if (context === "svg" && elementName !== "a") {
        // use/gradients/patterns/textPath: same-document references only.
        return kind === "fragment" ? value : undefined;
      }
      // Hyperlinks: internal (fragment or relative) targets only.
      return kind === "fragment" || kind === "relative" ? value : undefined;
    }

    if (
      (attributeName === "src" && elementName === "img") ||
      attributeName === "poster"
    ) {
      return this.sanitizeImageUrl(value, kind);
    }

    return kind === "fragment" || kind === "relative" || kind === "data-image"
      ? value
      : undefined;
  }

  private sanitizeImageUrl(value: string, kind: UrlKind): string | undefined {
    if (kind === "data-image" || kind === "fragment") return value;
    if (kind === "relative") {
      return this.options.resolveImage?.(value.trim()) ?? value;
    }
    return undefined;
  }

  private warn(message: string): void {
    const where = this.options.sectionHref
      ? ` (section '${this.options.sectionHref}')`
      : "";
    this.options.onWarning?.(`${message}${where}`);
  }
}

// ---------------------------------------------------------------------------
// Parsing entry points
// ---------------------------------------------------------------------------

function parseXhtml(markup: string): XmlDocument | undefined {
  try {
    const document = new DOMParser({
      // Collect nothing: recoverable errors still yield a DOM that is
      // re-serialized safely; fatal errors throw and trigger the fallback.
      onError: () => undefined,
    }).parseFromString(markup, "application/xhtml+xml");
    return document.documentElement ? document : undefined;
  } catch {
    return undefined;
  }
}

function firstChildElement(
  parent: XmlNode,
  localName: string,
): XmlElement | undefined {
  for (
    let child: XmlNode | null = parent.firstChild;
    child;
    child = child.nextSibling
  ) {
    if (
      child.nodeType === ELEMENT_NODE &&
      (child.localName ?? child.nodeName).toLowerCase() === localName
    ) {
      return child as XmlElement;
    }
  }
  return undefined;
}

/** Linear tag stripper used only for the unparsable-markup fallback. */
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

/**
 * Sanitizes one section's XHTML into safe HTML body markup.
 *
 * The markup is parsed with @xmldom/xmldom (sections that passed the EPUB loader
 * are well-formed XML). Only the `<body>` content is returned. When the markup
 * cannot be parsed even as a fragment, its text is returned fully escaped.
 */
export function sanitizeXhtmlSection(
  markup: string,
  options: XhtmlSanitizeOptions = {},
): string {
  let document = parseXhtml(markup);
  let wrapped = false;
  if (!document && !/^\s*(?:\ufeff)?\s*<\?xml/i.test(markup)) {
    // Lenient retry for bare fragments with several root nodes.
    document = parseXhtml(
      `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>`,
    );
    wrapped = true;
  }

  const root = document?.documentElement;
  if (!root) {
    const where = options.sectionHref
      ? ` in section '${options.sectionHref}'`
      : "";
    options.onWarning?.(
      `Markup${where} could not be parsed as XHTML and was exported as plain text.`,
    );
    const text = stripTagsLinear(markup);
    return text
      ? `<div class="reflowpress-unparsed-section">${escapeText(text)}</div>`
      : "";
  }

  const serializer = new AllowlistSerializer(options);
  const rootName = (root.localName ?? root.nodeName).toLowerCase();
  if (rootName === "html") {
    const body = firstChildElement(root, "body");
    return serializer.serializeChildren(body ?? root, "html");
  }
  if (rootName === "body" || wrapped) {
    return serializer.serializeChildren(root, "html");
  }
  return serializer.serializeNode(root, "html");
}

/**
 * Sanitizes an already parsed xmldom node (including the node itself), e.g. a
 * MathML island extracted by the Markdown exporter.
 */
export function sanitizeXmlNode(
  node: XmlNode,
  options: XhtmlSanitizeOptions = {},
): string {
  return new AllowlistSerializer(options).serializeNode(node, "html");
}

/**
 * Sanitizes a standalone SVG document (e.g. an image asset that will be written
 * next to a Markdown export) and returns well-formed SVG XML, or undefined when
 * the input is not a parsable SVG document.
 */
export function sanitizeSvgDocument(svgText: string): string | undefined {
  let document: XmlDocument;
  try {
    document = new DOMParser({ onError: () => undefined }).parseFromString(
      svgText,
      "image/svg+xml",
    );
  } catch {
    return undefined;
  }
  const root = document.documentElement;
  if (!root || (root.localName ?? root.nodeName).toLowerCase() !== "svg") {
    return undefined;
  }
  const body = new AllowlistSerializer({ xmlCompatible: true }).serializeNode(
    root,
    "html",
  );
  if (!body.startsWith("<svg")) return undefined;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${body.slice(4)}`;
}

// ---------------------------------------------------------------------------
// Resource inlining
// ---------------------------------------------------------------------------

/** Validates a manifest media type before it is interpolated into a data: URL. */
export function isSafeMediaType(mediaType: string): boolean {
  return MEDIA_TYPE_PATTERN.test(mediaType);
}

export function resolveRelativePath(
  baseHref: string,
  relativeHref: string,
): string {
  if (relativeHref.startsWith("/")) {
    return relativeHref.slice(1);
  }
  const parts = baseHref.split("/");
  parts.pop();
  for (const segment of relativeHref.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolves image references to inline data: URLs under a total byte budget.
 *
 * Every inlined occurrence counts against the budget (re-inlining the same
 * large asset many times would otherwise multiply the output size), each asset
 * is base64-encoded at most once, and only image/* resources with a valid media
 * type are ever inlined.
 */
export class InlineResourceResolver {
  private readonly byHref = new Map<string, PublicationResource>();
  private readonly byBasename = new Map<string, PublicationResource>();
  private readonly encoded = new Map<PublicationResource, string>();
  private readonly reported = new Set<string>();
  private readonly warnings: string[] = [];
  private inlinedBytes = 0;

  constructor(
    resources: readonly PublicationResource[],
    private readonly maxTotalBytes: number = DEFAULT_MAX_INLINE_ASSET_BYTES,
  ) {
    for (const resource of resources) {
      if (!this.byHref.has(resource.href)) {
        this.byHref.set(resource.href, resource);
      }
      const basename = resource.href.split("/").pop();
      if (basename && !this.byBasename.has(basename)) {
        this.byBasename.set(basename, resource);
      }
    }
  }

  getWarnings(): readonly string[] {
    return this.warnings;
  }

  getInlinedBytes(): number {
    return this.inlinedBytes;
  }

  resolveImage(sectionHref: string, reference: string): string | undefined {
    const resource = this.lookup(sectionHref, reference);
    if (!resource) return undefined;

    const mediaType = resource.mediaType.trim().toLowerCase();
    if (!isSafeMediaType(mediaType) || !mediaType.startsWith("image/")) {
      this.warnOnce(
        `invalid-type:${resource.href}`,
        `Asset '${resource.href}' was not inlined because its media type is not a valid image type.`,
      );
      return undefined;
    }

    const size = resource.bytes.length;
    if (this.inlinedBytes + size > this.maxTotalBytes) {
      this.warnOnce(
        `budget:${resource.href}`,
        `Asset '${resource.href}' (${size} bytes) was omitted from inlining because the maximum threshold (${this.maxTotalBytes} bytes) was reached.`,
      );
      return undefined;
    }
    this.inlinedBytes += size;

    let dataUrl = this.encoded.get(resource);
    if (dataUrl === undefined) {
      dataUrl = `data:${mediaType};base64,${Buffer.from(resource.bytes).toString("base64")}`;
      this.encoded.set(resource, dataUrl);
    }
    return dataUrl;
  }

  private lookup(
    sectionHref: string,
    reference: string,
  ): PublicationResource | undefined {
    const path = reference.split("#")[0]?.split("?")[0] ?? "";
    if (!path) return undefined;
    const decoded = safeDecodeUri(path);
    const candidates = [
      resolveRelativePath(sectionHref, path),
      resolveRelativePath(sectionHref, decoded),
      path,
      decoded,
    ];
    for (const candidate of candidates) {
      const found = this.byHref.get(candidate);
      if (found) return found;
    }
    const basename = path.split("/").pop() ?? "";
    return (
      this.byBasename.get(basename) ??
      this.byBasename.get(safeDecodeUri(basename))
    );
  }

  private warnOnce(key: string, message: string): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.warnings.push(message);
  }
}

// ---------------------------------------------------------------------------
// Publication-level helper shared by the HTML and PDF exporters
// ---------------------------------------------------------------------------

export interface SanitizedSection {
  /** Manifest id (NOT escaped; callers must escape it when interpolating). */
  readonly id: string;
  readonly href: string;
  /** Sanitized body markup, safe to embed into an HTML document. */
  readonly html: string;
}

export interface SanitizedPublicationContent {
  readonly sections: readonly SanitizedSection[];
  /** Sanitized stylesheets, safe to embed into a `<style>` element. */
  readonly stylesheets: readonly string[];
  readonly warnings: readonly string[];
}

export interface SanitizePublicationOptions {
  readonly maxInlineAssetBytes?: number | undefined;
}

/**
 * Sanitizes every reading-order section and stylesheet of a publication and
 * inlines referenced images as data: URLs (within the byte budget).
 */
export function sanitizePublicationContent(
  publication: NormalizedPublication,
  options?: SanitizePublicationOptions,
): SanitizedPublicationContent {
  const warnings: string[] = [];
  const resolver = new InlineResourceResolver(
    publication.resources,
    options?.maxInlineAssetBytes ?? DEFAULT_MAX_INLINE_ASSET_BYTES,
  );

  const stylesheets: string[] = [];
  for (const resource of publication.resources) {
    if (resource.mediaType.trim().toLowerCase() !== "text/css") continue;
    const css = normalizeLegacyEpubCss(
      new TextDecoder("utf-8").decode(resource.bytes),
    );
    const result = sanitizeStylesheet(css);
    if (result.dropped) {
      warnings.push(
        `Stylesheet '${resource.href}' contained unsafe constructs and was omitted.`,
      );
      continue;
    }
    stylesheets.push(result.css);
  }

  const sections: SanitizedSection[] = publication.readingOrder.map(
    (section) => ({
      id: section.id,
      href: section.href,
      html: sanitizeXhtmlSection(section.markup, {
        sectionHref: section.href,
        resolveImage: (reference) =>
          resolver.resolveImage(section.href, reference),
        onWarning: (message) => warnings.push(message),
      }),
    }),
  );

  warnings.push(...resolver.getWarnings());
  return { sections, stylesheets, warnings };
}
