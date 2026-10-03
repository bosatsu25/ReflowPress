import type { SearchOptions, SearchProgress, SearchResult } from "./models.js";
import { createSearchSnippet } from "./text-extractor.js";
import type { PdfPublicationLocator } from "@reflowpress/annotations";

export interface PdfSearchPageInput {
  page: number; // 1-indexed
  text: string;
}

export function searchPdfPages(
  publicationId: string,
  pages: PdfSearchPageInput[],
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

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    if (abortSignal?.aborted) break;

    onProgress?.({
      current: pIdx + 1,
      total: pages.length,
      phase: "searching",
    });

    const pageItem = pages[pIdx]!;
    const pageText = pageItem.text;
    const targetText = caseSensitive ? pageText : pageText.toLowerCase();

    let pos = targetText.indexOf(searchQuery);
    while (pos !== -1) {
      if (abortSignal?.aborted) break;

      const matchStart = pos;
      const matchLength = trimmed.length;
      const matchEnd = matchStart + matchLength;

      const snippet = createSearchSnippet(
        pageText,
        matchStart,
        matchLength,
        snippetLen,
      );

      // Context for TextQuoteSelector
      const prefixStart = Math.max(0, matchStart - 30);
      const suffixEnd = Math.min(pageText.length, matchEnd + 30);
      const prefix = pageText.slice(prefixStart, matchStart);
      const suffix = pageText.slice(matchEnd, suffixEnd);

      const locator: PdfPublicationLocator = {
        kind: "pdf",
        page: pageItem.page,
        textQuote: {
          exact: pageText.slice(matchStart, matchEnd),
          prefix: prefix || undefined,
          suffix: suffix || undefined,
        },
        textPosition: {
          start: matchStart,
          end: matchEnd,
        },
      };

      results.push({
        id: `pdf-sr-${globalMatchIndex}`,
        publicationId,
        locator,
        page: pageItem.page,
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
    current: pages.length,
    total: pages.length,
    phase: "complete",
  });

  return results;
}
