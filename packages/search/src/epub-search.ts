import type { SearchOptions, SearchProgress, SearchResult } from "./models.js";
import { createSearchSnippet, extractVisibleText } from "./text-extractor.js";
import type { EpubPublicationLocator } from "@reflowpress/annotations";

export interface EpubSearchSectionInput {
  href: string;
  title?: string | undefined;
  content: string; // raw HTML/XHTML or pre-extracted text
  isPreExtracted?: boolean | undefined;
}

export function searchEpubSections(
  publicationId: string,
  sections: EpubSearchSectionInput[],
  query: string,
  options?: SearchOptions | undefined,
  onProgress?: ((progress: SearchProgress) => void) | undefined,
  abortSignal?: AbortSignal | undefined,
): SearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const maxResults = options?.maxResults ?? 500;
  const snippetLen = options?.snippetLength ?? 50;
  const caseSensitive = options?.caseSensitive ?? false;

  const searchQuery = caseSensitive ? trimmed : trimmed.toLowerCase();
  const results: SearchResult[] = [];
  let globalMatchIndex = 0;

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    if (abortSignal?.aborted) break;

    onProgress?.({
      current: sIdx + 1,
      total: sections.length,
      phase: "searching",
    });

    const section = sections[sIdx]!;
    const visibleText = section.isPreExtracted
      ? section.content
      : extractVisibleText(section.content);

    const targetText = caseSensitive ? visibleText : visibleText.toLowerCase();

    let pos = targetText.indexOf(searchQuery);
    while (pos !== -1) {
      if (abortSignal?.aborted) break;

      const matchStart = pos;
      const matchLength = trimmed.length;
      const matchEnd = matchStart + matchLength;

      const snippet = createSearchSnippet(
        visibleText,
        matchStart,
        matchLength,
        snippetLen,
      );

      // Context for TextQuoteSelector
      const prefixStart = Math.max(0, matchStart - 30);
      const suffixEnd = Math.min(visibleText.length, matchEnd + 30);
      const prefix = visibleText.slice(prefixStart, matchStart);
      const suffix = visibleText.slice(matchEnd, suffixEnd);

      const progress =
        visibleText.length > 0 ? matchStart / visibleText.length : 0;

      const locator: EpubPublicationLocator = {
        kind: "epub",
        sectionHref: section.href,
        progress: Math.round(progress * 1000) / 1000,
        textQuote: {
          exact: visibleText.slice(matchStart, matchEnd),
          prefix: prefix || undefined,
          suffix: suffix || undefined,
        },
        textPosition: {
          start: matchStart,
          end: matchEnd,
        },
      };

      results.push({
        id: `sr-${globalMatchIndex}`,
        publicationId,
        locator,
        sectionHref: section.href,
        sectionTitle: section.title,
        snippet,
        matchIndex: globalMatchIndex,
        characterOffset: matchStart,
      });

      globalMatchIndex++;
      if (results.length >= maxResults) {
        return results;
      }

      pos = targetText.indexOf(searchQuery, pos + 1);
    }
  }

  onProgress?.({
    current: sections.length,
    total: sections.length,
    phase: "complete",
  });

  return results;
}
