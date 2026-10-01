export interface EpubLocation {
  readonly kind: "epub";
  readonly sectionId: string;
  readonly sectionHref: string;
  readonly progress: number;
}

export interface PdfLocation {
  readonly kind: "pdf";
  readonly page: number;
  readonly zoom: number;
}

export type ReaderLocation = EpubLocation | PdfLocation;

export interface SavedReadingPosition {
  readonly publicationId: string;
  readonly location: ReaderLocation;
  readonly updatedAt: string;
}
