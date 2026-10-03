export type AnnotationColor = "yellow" | "green" | "blue" | "pink";

export interface TextQuoteSelector {
  exact: string;
  prefix?: string | undefined;
  suffix?: string | undefined;
}

export interface TextPositionSelector {
  start: number;
  end: number;
}

export interface NormalizedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EpubPublicationLocator {
  kind: "epub";
  sectionHref: string;
  progress?: number | undefined; // 0.0 to 1.0 scroll progress within section
  textQuote?: TextQuoteSelector | undefined;
  textPosition?: TextPositionSelector | undefined;
  structuralHint?: string | undefined;
}

export interface PdfPublicationLocator {
  kind: "pdf";
  page: number; // 1-indexed
  zoom?: number | undefined;
  textQuote?: TextQuoteSelector | undefined;
  textPosition?: TextPositionSelector | undefined;
  normalizedRects?: NormalizedRect[] | undefined;
}

export type PublicationLocator = EpubPublicationLocator | PdfPublicationLocator;

export interface AnnotationBase {
  id: string;
  publicationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkAnnotation extends AnnotationBase {
  kind: "bookmark";
  locator: PublicationLocator;
  label?: string | undefined;
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: "highlight";
  locator: PublicationLocator;
  color: AnnotationColor;
  textQuote: TextQuoteSelector;
  noteId?: string | undefined;
  status: "active" | "orphaned";
}

export interface NoteAnnotation extends AnnotationBase {
  kind: "note";
  locator: PublicationLocator;
  body: string;
  highlightId?: string | undefined;
}

export type Annotation =
  BookmarkAnnotation | HighlightAnnotation | NoteAnnotation;

export interface AnnotationStore {
  schemaVersion: number;
  annotations: Annotation[];
}

export interface PublicationIdentity {
  identifier?: string | undefined;
  title: string;
  creator?: string | undefined;
  format: "epub" | "pdf";
}

export interface AnnotationSortCriteria {
  field: "createdAt" | "updatedAt" | "location";
  direction: "asc" | "desc";
}

export interface AnnotationFilterCriteria {
  publicationId?: string | undefined;
  kind?: "all" | "bookmark" | "highlight" | "note" | undefined;
  query?: string | undefined;
  color?: AnnotationColor | undefined;
}
