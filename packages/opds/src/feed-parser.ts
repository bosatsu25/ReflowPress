import { DOMParser } from "@xmldom/xmldom";
import {
  type OpdsFeed,
  type OpdsPublication,
  type OpdsLink,
  OPDS_RELS,
} from "./models.js";

export function parseOpdsFeed(content: string, contentType?: string): OpdsFeed {
  const trimmed = content.trim();

  // Try JSON (OPDS 2.0)
  if (
    contentType?.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      return parseOpds2Json(data);
    } catch (err) {
      if (contentType?.includes("json")) {
        throw new Error(
          `Failed to parse OPDS 2.0 JSON feed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      // Fall through to XML attempt if content type was ambiguous
    }
  }

  // Fallback: OPDS 1.2 Atom XML
  return parseOpds1Atom(trimmed);
}

function parseOpds2Json(data: unknown): OpdsFeed {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid OPDS 2.0 feed: expected an object");
  }

  const obj = data as Record<string, unknown>;
  const rawMeta = (obj.metadata as Record<string, unknown>) ?? {};
  const rawLinks = Array.isArray(obj.links) ? obj.links : [];
  const rawPubs = Array.isArray(obj.publications) ? obj.publications : [];

  const links: OpdsLink[] = rawLinks.map((l: unknown) => {
    const link = l as Record<string, unknown>;
    return {
      href: String(link.href ?? ""),
      rel: Array.isArray(link.rel)
        ? (link.rel as string[])
        : String(link.rel ?? ""),
      type: link.type ? String(link.type) : undefined,
      title: link.title ? String(link.title) : undefined,
    };
  });

  const publications: OpdsPublication[] = rawPubs.map((p: unknown) => {
    const pub = p as Record<string, unknown>;
    const pMeta = (pub.metadata as Record<string, unknown>) ?? {};
    const pLinks = Array.isArray(pub.links) ? pub.links : [];
    const pImages = Array.isArray(pub.images) ? pub.images : [];

    return {
      metadata: {
        title: String(pMeta.title ?? "Untitled"),
        author: typeof pMeta.author === "string" ? pMeta.author : undefined,
        identifier: pMeta.identifier ? String(pMeta.identifier) : undefined,
        modified: pMeta.modified ? String(pMeta.modified) : undefined,
        description: pMeta.description ? String(pMeta.description) : undefined,
        language: pMeta.language ? String(pMeta.language) : undefined,
        publisher: pMeta.publisher ? String(pMeta.publisher) : undefined,
      },
      links: pLinks.map((l: unknown) => {
        const link = l as Record<string, unknown>;
        return {
          href: String(link.href ?? ""),
          rel: Array.isArray(link.rel)
            ? (link.rel as string[])
            : String(link.rel ?? ""),
          type: link.type ? String(link.type) : undefined,
          title: link.title ? String(link.title) : undefined,
        };
      }),
      images: pImages.map((img: unknown) => {
        const image = img as Record<string, unknown>;
        return {
          href: String(image.href ?? ""),
          rel: Array.isArray(image.rel)
            ? (image.rel as string[])
            : String(image.rel ?? OPDS_RELS.IMAGE),
          type: image.type ? String(image.type) : undefined,
        };
      }),
    };
  });

  return {
    "@context": obj["@context"] as string | readonly string[] | undefined,
    metadata: {
      title: String(rawMeta.title ?? "OPDS Catalog"),
      numberOfItems:
        typeof rawMeta.numberOfItems === "number"
          ? rawMeta.numberOfItems
          : undefined,
      modified: rawMeta.modified ? String(rawMeta.modified) : undefined,
    },
    links,
    publications,
  };
}

function parseOpds1Atom(xmlContent: string): OpdsFeed {
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === "fatalError") {
        throw new Error(`XML parsing error: ${msg}`);
      }
    },
  });

  const doc = parser.parseFromString(xmlContent, "text/xml");
  const feedEl = doc.documentElement;
  if (!feedEl || feedEl.localName !== "feed") {
    throw new Error("Invalid OPDS 1.2 feed: root element is not <feed>");
  }

  // Extract feed title
  let feedTitle = "OPDS 1.2 Catalog";
  const titleNodes = feedEl.getElementsByTagName("title");
  if (titleNodes.length > 0 && titleNodes[0]?.textContent) {
    feedTitle = titleNodes[0].textContent.trim();
  }

  // Extract feed links
  const feedLinks: OpdsLink[] = [];
  const linkNodes = feedEl.getElementsByTagName("link");
  for (let i = 0; i < linkNodes.length; i++) {
    const el = linkNodes[i];
    if (el && el.parentNode === feedEl) {
      feedLinks.push({
        href: el.getAttribute("href") ?? "",
        rel: el.getAttribute("rel") ?? "",
        type: el.getAttribute("type") ?? undefined,
        title: el.getAttribute("title") ?? undefined,
      });
    }
  }

  // Extract entries
  const publications: OpdsPublication[] = [];
  const entryNodes = feedEl.getElementsByTagName("entry");

  for (let i = 0; i < entryNodes.length; i++) {
    const entry = entryNodes[i];
    if (!entry) continue;

    let title = "Untitled";
    const entryTitle = entry.getElementsByTagName("title")[0]?.textContent;
    if (entryTitle) title = entryTitle.trim();

    let identifier: string | undefined;
    const entryId = entry.getElementsByTagName("id")[0]?.textContent;
    if (entryId) identifier = entryId.trim();

    let author: string | undefined;
    const authorEl = entry.getElementsByTagName("author")[0];
    if (authorEl) {
      const name = authorEl.getElementsByTagName("name")[0]?.textContent;
      if (name) author = name.trim();
    }

    let description: string | undefined;
    const summary = entry.getElementsByTagName("summary")[0]?.textContent;
    const content = entry.getElementsByTagName("content")[0]?.textContent;
    if (summary) description = summary.trim();
    else if (content) description = content.trim();

    const pLinks: OpdsLink[] = [];
    const pImages: OpdsLink[] = [];
    const entryLinkNodes = entry.getElementsByTagName("link");

    for (let j = 0; j < entryLinkNodes.length; j++) {
      const linkEl = entryLinkNodes[j];
      if (!linkEl) continue;

      const href = linkEl.getAttribute("href") ?? "";
      const rel = linkEl.getAttribute("rel") ?? "";
      const type = linkEl.getAttribute("type") ?? undefined;
      const linkTitle = linkEl.getAttribute("title") ?? undefined;

      if (
        rel === OPDS_RELS.IMAGE ||
        rel === OPDS_RELS.IMAGE_THUMBNAIL ||
        rel.includes("image")
      ) {
        pImages.push({ href, rel, type });
      } else {
        pLinks.push({ href, rel, type, title: linkTitle });
      }
    }

    publications.push({
      metadata: {
        title,
        identifier,
        author,
        description,
      },
      links: pLinks,
      images: pImages,
    });
  }

  return {
    metadata: {
      title: feedTitle,
      numberOfItems: publications.length,
    },
    links: feedLinks,
    publications,
  };
}
