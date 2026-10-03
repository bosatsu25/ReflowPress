import { createHash } from "node:crypto";
import type { LibraryBook } from "@reflowpress/library";
import type { PortablePublicationId } from "./models.js";

/**
 * Computes a portable, machine-independent publication identifier.
 *
 * Priority order:
 * 1. Explicit clean metadata identifier (e.g., URN:UUID, ISBN, or Calibre/IDPF UUID)
 * 2. SHA-256 fingerprint of normalized (title, author, format)
 *
 * NOTE: Local filesystem paths are NEVER used in portable identity computation.
 */
export function computePortablePublicationId(input: {
  readonly identifier?: string | undefined;
  readonly title: string;
  readonly author?: string | undefined;
  readonly contentHash?: string | undefined;
  readonly format?: string | undefined;
}): PortablePublicationId {
  if (input.contentHash && input.contentHash.length >= 16) {
    return `hash-${input.contentHash.slice(0, 32)}`;
  }

  const rawId = input.identifier?.trim();
  if (
    rawId &&
    rawId.length >= 5 &&
    !rawId.includes("\\") &&
    !rawId.includes("/")
  ) {
    // Clean identifier: remove urn:uuid: prefix or whitespace
    const normalized = rawId
      .replace(/^urn:uuid:/i, "")
      .replace(/^urn:isbn:/i, "")
      .trim();
    if (normalized.length > 0) {
      return `pub-${normalized.toLowerCase()}`;
    }
  }

  // Fallback: SHA-256 fingerprint of title + author
  const normTitle = input.title.trim().toLowerCase();
  const normAuthor = (input.author ?? "unknown").trim().toLowerCase();
  const hash = createHash("sha256")
    .update(`${normTitle}:::${normAuthor}`)
    .digest("hex")
    .slice(0, 24);

  return `fp-${hash}`;
}

export function getPortableIdForBook(book: LibraryBook): PortablePublicationId {
  return computePortablePublicationId({
    identifier: book.identifier,
    title: book.title,
    author: book.creator,
  });
}
