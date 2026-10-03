import type { PublicationLocator } from "@reflowpress/annotations";

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  id: string;
  publicationId: string;
  locator: PublicationLocator;
  sectionHref?: string | undefined;
  sectionTitle?: string | undefined;
  page?: number | undefined;
  snippet: SearchSnippet;
  matchIndex: number;
  characterOffset: number;
}

export interface SearchOptions {
  maxResults?: number | undefined;
  snippetLength?: number | undefined; // default 50
  caseSensitive?: boolean | undefined;
}

export interface SearchProgress {
  current: number;
  total: number;
  phase: "extracting" | "searching" | "complete";
}
