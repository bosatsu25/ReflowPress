import path from "node:path";
import type { Element, Document } from "@xmldom/xmldom";
import type { NavigationItem } from "@reflowpress/core";
import { directChildren, firstDirectChild } from "./xml.js";

/**
 * Parses an EPUB 3 Navigation Document (<nav epub:type="toc">) into a unified NavigationItem tree.
 */
export function parseNavDocument<E extends Error>(
  document: Document,
  navDocumentPath: string,
  createError: (message: string, cause?: unknown) => E,
): readonly NavigationItem[] {
  const root = document.documentElement;
  if (!root) throw createError("Navigation document has no root element.");

  // Find <nav epub:type="toc"> or fallback to first <nav>
  const navElements = findDescendantElements(root, "nav");
  const tocNav =
    navElements.find(
      (element) =>
        element.getAttribute("epub:type") === "toc" ||
        element.getAttribute("type") === "toc" ||
        element.getAttribute("id") === "toc",
    ) ?? navElements[0];

  if (!tocNav) {
    return [];
  }

  const ol = firstDirectChild(tocNav, "ol");
  if (!ol) return [];

  const baseDirectory = path.posix.dirname(navDocumentPath);
  return parseNavOl(ol, baseDirectory, createError);
}

function parseNavOl<E extends Error>(
  ol: Element,
  baseDirectory: string,
  createError: (message: string, cause?: unknown) => E,
): NavigationItem[] {
  const items: NavigationItem[] = [];
  const liElements = directChildren(ol, "li");

  for (const li of liElements) {
    // Each <li> usually contains an <a> or <span>, plus an optional nested <ol>
    const a = firstDirectChild(li, "a");
    const span = firstDirectChild(li, "span");
    const linkElement = a ?? span;

    const label = linkElement?.textContent?.trim() ?? "";
    const rawHref = a?.getAttribute("href")?.trim() ?? "";

    let resolvedHref = "";
    if (rawHref) {
      // Split fragment if any
      const [filePath, fragment] = rawHref.split("#", 2);
      const normalizedPath = filePath
        ? path.posix.normalize(
            path.posix.join(baseDirectory, decodeURIComponent(filePath)),
          )
        : baseDirectory;
      resolvedHref =
        fragment !== undefined
          ? `${normalizedPath}#${fragment}`
          : normalizedPath;
    }

    const nestedOl = firstDirectChild(li, "ol");
    const children = nestedOl
      ? parseNavOl(nestedOl, baseDirectory, createError)
      : undefined;

    const id =
      li.getAttribute("id")?.trim() || linkElement?.getAttribute("id")?.trim();

    items.push({
      ...(id ? { id } : {}),
      label: label || "Untitled",
      href: resolvedHref,
      ...(children && children.length > 0 ? { children } : {}),
    });
  }

  return items;
}

/**
 * Parses an EPUB 2 NCX document (toc.ncx) into a unified NavigationItem tree.
 */
export function parseNcxDocument<E extends Error>(
  document: Document,
  ncxPath: string,
  createError: (message: string, cause?: unknown) => E,
): readonly NavigationItem[] {
  const root = document.documentElement;
  if (!root || root.localName !== "ncx") {
    throw createError("NCX document root must be ncx.");
  }

  const navMap = firstDirectChild(root, "navMap");
  if (!navMap) return [];

  const baseDirectory = path.posix.dirname(ncxPath);
  return parseNcxNavPoints(navMap, baseDirectory, createError);
}

function parseNcxNavPoints<E extends Error>(
  parent: Element,
  baseDirectory: string,
  createError: (message: string, cause?: unknown) => E,
): NavigationItem[] {
  const items: NavigationItem[] = [];
  const navPoints = directChildren(parent, "navPoint");

  for (const navPoint of navPoints) {
    const id = navPoint.getAttribute("id")?.trim();
    const navLabel = firstDirectChild(navPoint, "navLabel");
    const textElement = navLabel
      ? firstDirectChild(navLabel, "text")
      : undefined;
    const label = textElement?.textContent?.trim() ?? "Untitled";

    const content = firstDirectChild(navPoint, "content");
    const rawSrc = content?.getAttribute("src")?.trim() ?? "";

    let resolvedHref = "";
    if (rawSrc) {
      const [filePath, fragment] = rawSrc.split("#", 2);
      const normalizedPath = filePath
        ? path.posix.normalize(
            path.posix.join(baseDirectory, decodeURIComponent(filePath)),
          )
        : baseDirectory;
      resolvedHref =
        fragment !== undefined
          ? `${normalizedPath}#${fragment}`
          : normalizedPath;
    }

    const children = parseNcxNavPoints(navPoint, baseDirectory, createError);

    items.push({
      ...(id ? { id } : {}),
      label,
      href: resolvedHref,
      ...(children && children.length > 0 ? { children } : {}),
    });
  }

  return items;
}

function findDescendantElements(root: Element, localName: string): Element[] {
  const results: Element[] = [];
  const walk = (node: Element) => {
    if (node.localName === localName) {
      results.push(node);
    }
    for (let index = 0; index < node.childNodes.length; index += 1) {
      const child = node.childNodes.item(index);
      if (child && child.nodeType === 1) {
        walk(child as Element);
      }
    }
  };
  walk(root);
  return results;
}
