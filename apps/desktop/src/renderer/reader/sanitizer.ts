import type { ReaderSettings } from "@reflowpress/reader";
import {
  resolveResourceHref,
  type PublicationResourceManager,
} from "./resource-manager.js";

const DANGEROUS_TAGS = new Set([
  "script",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "base",
]);

export function getThemeColors(theme: ReaderSettings["theme"]): {
  bg: string;
  color: string;
  link: string;
} {
  switch (theme) {
    case "dark":
      return { bg: "#181818", color: "#e0e0e0", link: "#78aeed" };
    case "sepia":
      return { bg: "#fbf0d9", color: "#3c3226", link: "#8f5b28" };
    case "light":
    default:
      return { bg: "#ffffff", color: "#1a1a1a", link: "#1a5fb4" };
  }
}

export function sanitizeXhtml(
  rawHtml: string,
  sectionHref: string,
  resourceManager?: PublicationResourceManager,
  settings?: ReaderSettings,
): string {
  if (!rawHtml) return "";

  const parser = new DOMParser();
  // Try parsing as text/html first for robust handling of unescaped entities/malformed xhtml
  const doc = parser.parseFromString(rawHtml, "text/html");

  // 1. Remove dangerous tags
  for (const tag of DANGEROUS_TAGS) {
    const elements = doc.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  }

  // Remove meta http-equiv tags
  const metaElements = doc.querySelectorAll("meta[http-equiv]");
  metaElements.forEach((el) => el.remove());

  // 2. Iterate all elements to sanitize attributes
  const allElements = doc.querySelectorAll("*");
  allElements.forEach((el) => {
    const attributeNames = el.getAttributeNames();
    for (const name of attributeNames) {
      // Remove inline event handlers (onload, onclick, etc.)
      if (name.toLowerCase().startsWith("on")) {
        el.removeAttribute(name);
        continue;
      }

      const val = el.getAttribute(name) ?? "";
      // Strip javascript: URLs
      if (
        (name.toLowerCase() === "href" ||
          name.toLowerCase() === "src" ||
          name.toLowerCase().endsWith("href")) &&
        val.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(name);
        continue;
      }
    }

    // Sanitize style attribute
    const styleAttr = el.getAttribute("style");
    if (styleAttr) {
      const sanitizedStyle = styleAttr
        .replace(/expression\s*\(.*?\)/gi, "")
        .replace(/javascript\s*:/gi, "");
      el.setAttribute("style", sanitizedStyle);
    }
  });

  // 3. Resolve and rewrite media resources (images, audio, video, source)
  if (resourceManager) {
    const mediaElements = doc.querySelectorAll("img, audio, video, source");
    mediaElements.forEach((el) => {
      const src = el.getAttribute("src");
      if (
        src &&
        !src.startsWith("data:") &&
        !src.startsWith("blob:") &&
        !src.startsWith("http:") &&
        !src.startsWith("https:")
      ) {
        const resolved = resolveResourceHref(sectionHref, src);
        const blobUrl = resourceManager.getBlobUrl(resolved);
        if (blobUrl) {
          el.setAttribute("src", blobUrl);
        }
      }
    });

    // SVG <image> elements (xlink:href and href)
    const svgImages = doc.querySelectorAll("image");
    svgImages.forEach((el) => {
      const href = el.getAttribute("href") ?? el.getAttribute("xlink:href");
      if (href && !href.startsWith("data:") && !href.startsWith("blob:")) {
        const resolved = resolveResourceHref(sectionHref, href);
        const blobUrl = resourceManager.getBlobUrl(resolved);
        if (blobUrl) {
          el.setAttribute("href", blobUrl);
          el.removeAttribute("xlink:href");
        }
      }
    });

    // Stylesheet links
    const linkElements = doc.querySelectorAll("link[rel='stylesheet']");
    linkElements.forEach((el) => {
      const href = el.getAttribute("href");
      if (
        href &&
        !href.startsWith("http:") &&
        !href.startsWith("https:") &&
        !href.startsWith("data:") &&
        !href.startsWith("blob:")
      ) {
        const resolved = resolveResourceHref(sectionHref, href);
        const blobUrl = resourceManager.getBlobUrl(resolved);
        if (blobUrl) {
          el.setAttribute("href", blobUrl);
        }
      }
    });
  }

  // 4. Inject theme and typography styles if settings are provided
  if (settings) {
    const { bg, color, link } = getThemeColors(settings.theme);
    const styleEl = doc.createElement("style");
    styleEl.setAttribute("id", "reflowpress-reader-theme");
    styleEl.textContent = `
      :root {
        --rf-bg: ${bg};
        --rf-color: ${color};
        --rf-link: ${link};
        --rf-font-family: ${settings.fontFamily};
        --rf-font-size: ${settings.fontSize}px;
        --rf-line-height: ${settings.lineHeight};
        --rf-margin: ${settings.margin}px;
      }
      html {
        background-color: var(--rf-bg) !important;
        color: var(--rf-color) !important;
      }
      body {
        background-color: var(--rf-bg) !important;
        color: var(--rf-color) !important;
        font-family: var(--rf-font-family) !important;
        font-size: var(--rf-font-size) !important;
        line-height: var(--rf-line-height) !important;
        padding-top: var(--rf-margin) !important;
        padding-bottom: var(--rf-margin) !important;
        padding-left: clamp(16px, var(--rf-margin), 96px) !important;
        padding-right: clamp(16px, var(--rf-margin), 96px) !important;
        max-width: 820px !important;
        margin-left: auto !important;
        margin-right: auto !important;
        box-sizing: border-box !important;
        word-break: break-word !important;
      }
      a {
        color: var(--rf-link) !important;
      }
      img, svg, video {
        max-width: 100% !important;
        height: auto !important;
        box-sizing: border-box !important;
      }
    `;

    if (doc.head) {
      doc.head.appendChild(styleEl);
    } else if (doc.body) {
      doc.body.insertBefore(styleEl, doc.body.firstChild);
    }
  }

  return doc.documentElement ? doc.documentElement.outerHTML : rawHtml;
}
