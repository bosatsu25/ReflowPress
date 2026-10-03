/**
 * OPDS 2.0 Models and Types
 * Reference: https://specs.opds.io/opds-2.0
 */

export interface OpdsLink {
  readonly href: string;
  readonly type?: string | undefined;
  readonly rel: string | readonly string[];
  readonly title?: string | undefined;
  readonly properties?: Record<string, unknown> | undefined;
  readonly height?: number | undefined;
  readonly width?: number | undefined;
}

export interface OpdsContributor {
  readonly name: string;
  readonly sortAs?: string | undefined;
  readonly identifier?: string | undefined;
  readonly role?: string | undefined;
}

export interface OpdsMetadata {
  readonly title: string;
  readonly identifier?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly modified?: string | undefined;
  readonly published?: string | undefined;
  readonly description?: string | undefined;
  readonly language?: string | readonly string[] | undefined;
  readonly author?:
    | string
    | OpdsContributor
    | readonly (string | OpdsContributor)[]
    | undefined;
  readonly publisher?: string | undefined;
  readonly numberOfPages?: number | undefined;
  readonly [key: string]: unknown;
}

export interface OpdsPublication {
  readonly metadata: OpdsMetadata;
  readonly links: readonly OpdsLink[];
  readonly images?: readonly OpdsLink[] | undefined;
}

export interface OpdsNavigationItem {
  readonly href: string;
  readonly title: string;
  readonly type?: string | undefined;
  readonly rel?: string | undefined;
  readonly numberOfItems?: number | undefined;
}

export interface OpdsFacet {
  readonly metadata: {
    readonly title: string;
  };
  readonly links: readonly OpdsLink[];
}

export interface OpdsGroup {
  readonly metadata: {
    readonly title: string;
    readonly numberOfItems?: number | undefined;
  };
  readonly links?: readonly OpdsLink[] | undefined;
  readonly publications?: readonly OpdsPublication[] | undefined;
  readonly navigation?: readonly OpdsNavigationItem[] | undefined;
}

export interface OpdsFeed {
  readonly "@context"?: string | readonly string[] | undefined;
  readonly metadata: OpdsMetadata;
  readonly links: readonly OpdsLink[];
  readonly publications?: readonly OpdsPublication[] | undefined;
  readonly navigation?: readonly OpdsNavigationItem[] | undefined;
  readonly facets?: readonly OpdsFacet[] | undefined;
  readonly groups?: readonly OpdsGroup[] | undefined;
}

export const OPDS2_MIME_TYPE = "application/opds+json";
export const OPDS2_CATALOG_CONTEXT =
  "https://readium.org/webpub-manifest/context.jsonld";
export const OPDS1_ACQUISITION_MIME_TYPE =
  "application/atom+xml;profile=opds-catalog;kind=acquisition";

export const OPDS_RELS = {
  SELF: "self",
  START: "start",
  FIRST: "first",
  LAST: "last",
  PREV: "prev",
  NEXT: "next",
  SEARCH: "search",
  ACQUISITION: "http://opds-spec.org/acquisition",
  ACQUISITION_OPEN_ACCESS: "http://opds-spec.org/acquisition/open-access",
  IMAGE: "http://opds-spec.org/image",
  IMAGE_THUMBNAIL: "http://opds-spec.org/image/thumbnail",
} as const;
