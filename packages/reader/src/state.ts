import type { NormalizedPublication } from "@reflowpress/core";
import type { ReaderSettings } from "./settings.js";

export type ReaderStatus = "no-document" | "loading" | "ready" | "error";

export interface NoDocumentState {
  readonly status: "no-document";
}

export interface LoadingState {
  readonly status: "loading";
  readonly message: string;
}

export interface EpubReadyState {
  readonly status: "ready";
  readonly format: "epub";
  readonly publication: NormalizedPublication;
  readonly publicationId: string;
  readonly activeSectionIndex: number;
  readonly progress: number;
  readonly settings: ReaderSettings;
  readonly tocOpen: boolean;
}

export interface PdfReadyState {
  readonly status: "ready";
  readonly format: "pdf";
  readonly title: string;
  readonly publicationId: string;
  readonly currentPage: number;
  readonly totalPages: number;
  readonly zoom: number;
  readonly settings: ReaderSettings;
  readonly tocOpen: boolean;
}

export interface ErrorState {
  readonly status: "error";
  readonly code: string;
  readonly message: string;
}

export type ReaderState =
  NoDocumentState | LoadingState | EpubReadyState | PdfReadyState | ErrorState;
