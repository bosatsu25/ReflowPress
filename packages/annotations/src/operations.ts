import type {
  Annotation,
  AnnotationColor,
  AnnotationFilterCriteria,
  AnnotationSortCriteria,
  AnnotationStore,
  BookmarkAnnotation,
  HighlightAnnotation,
  NoteAnnotation,
  PublicationLocator,
  TextQuoteSelector,
} from "./models.js";

export function generateAnnotationId(): string {
  // RFC4122 v4 UUID generator without external dependency
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createDefaultAnnotationStore(): AnnotationStore {
  return {
    schemaVersion: 1,
    annotations: [],
  };
}

export function locatorsMatch(
  locA: PublicationLocator,
  locB: PublicationLocator,
): boolean {
  if (locA.kind !== locB.kind) return false;

  if (locA.kind === "epub" && locB.kind === "epub") {
    if (locA.sectionHref !== locB.sectionHref) return false;
    // If progress is defined on both, check proximity within 1%
    if (locA.progress !== undefined && locB.progress !== undefined) {
      return Math.abs(locA.progress - locB.progress) < 0.01;
    }
    return true;
  }

  if (locA.kind === "pdf" && locB.kind === "pdf") {
    return locA.page === locB.page;
  }

  return false;
}

export function createBookmark(
  store: AnnotationStore,
  input: {
    publicationId: string;
    locator: PublicationLocator;
    label?: string | undefined;
  },
): {
  store: AnnotationStore;
  bookmark: BookmarkAnnotation;
  isDuplicate: boolean;
} {
  // Check for duplicate bookmark at same locator
  const existing = store.annotations.find(
    (a): a is BookmarkAnnotation =>
      a.kind === "bookmark" &&
      a.publicationId === input.publicationId &&
      locatorsMatch(a.locator, input.locator),
  );

  if (existing) {
    if (!existing.label && input.label) {
      const now = new Date().toISOString();
      const updatedBookmark: BookmarkAnnotation = {
        ...existing,
        label: input.label,
        updatedAt: now,
      };
      return {
        store: {
          ...store,
          annotations: store.annotations.map((a) =>
            a.id === existing.id ? updatedBookmark : a,
          ),
        },
        bookmark: updatedBookmark,
        isDuplicate: false,
      };
    }
    return { store, bookmark: existing, isDuplicate: true };
  }

  const now = new Date().toISOString();
  const bookmark: BookmarkAnnotation = {
    id: generateAnnotationId(),
    publicationId: input.publicationId,
    kind: "bookmark",
    locator: input.locator,
    label: input.label,
    createdAt: now,
    updatedAt: now,
  };

  return {
    store: {
      ...store,
      annotations: [bookmark, ...store.annotations],
    },
    bookmark,
    isDuplicate: false,
  };
}

export function deleteBookmark(
  store: AnnotationStore,
  bookmarkId: string,
): AnnotationStore {
  return {
    ...store,
    annotations: store.annotations.filter((a) => a.id !== bookmarkId),
  };
}

export function createHighlight(
  store: AnnotationStore,
  input: {
    publicationId: string;
    locator: PublicationLocator;
    color: AnnotationColor;
    textQuote: TextQuoteSelector;
    noteId?: string | undefined;
  },
): { store: AnnotationStore; highlight: HighlightAnnotation } {
  const now = new Date().toISOString();
  const highlight: HighlightAnnotation = {
    id: generateAnnotationId(),
    publicationId: input.publicationId,
    kind: "highlight",
    locator: input.locator,
    color: input.color,
    textQuote: input.textQuote,
    noteId: input.noteId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  return {
    store: {
      ...store,
      annotations: [highlight, ...store.annotations],
    },
    highlight,
  };
}

export function updateHighlightColor(
  store: AnnotationStore,
  highlightId: string,
  color: AnnotationColor,
): AnnotationStore {
  const now = new Date().toISOString();
  return {
    ...store,
    annotations: store.annotations.map((a) =>
      a.id === highlightId && a.kind === "highlight"
        ? { ...a, color, updatedAt: now }
        : a,
    ),
  };
}

export function deleteHighlight(
  store: AnnotationStore,
  highlightId: string,
): AnnotationStore {
  // If highlight is deleted, unlink any note pointing to it
  return {
    ...store,
    annotations: store.annotations
      .filter((a) => a.id !== highlightId)
      .map((a) =>
        a.kind === "note" && a.highlightId === highlightId
          ? { ...a, highlightId: undefined }
          : a,
      ),
  };
}

export function createNote(
  store: AnnotationStore,
  input: {
    publicationId: string;
    locator: PublicationLocator;
    body: string;
    highlightId?: string | undefined;
  },
): { store: AnnotationStore; note: NoteAnnotation } {
  const now = new Date().toISOString();
  const noteId = generateAnnotationId();
  const note: NoteAnnotation = {
    id: noteId,
    publicationId: input.publicationId,
    kind: "note",
    locator: input.locator,
    body: input.body,
    highlightId: input.highlightId,
    createdAt: now,
    updatedAt: now,
  };

  // If linked to a highlight, update the highlight with noteId
  const updatedAnnotations = store.annotations.map((a) =>
    input.highlightId && a.id === input.highlightId && a.kind === "highlight"
      ? { ...a, noteId, updatedAt: now }
      : a,
  );

  return {
    store: {
      ...store,
      annotations: [note, ...updatedAnnotations],
    },
    note,
  };
}

export function updateNoteBody(
  store: AnnotationStore,
  noteId: string,
  body: string,
): AnnotationStore {
  const now = new Date().toISOString();
  return {
    ...store,
    annotations: store.annotations.map((a) =>
      a.id === noteId && a.kind === "note" ? { ...a, body, updatedAt: now } : a,
    ),
  };
}

export function deleteNote(
  store: AnnotationStore,
  noteId: string,
): AnnotationStore {
  // If note is deleted, unlink any highlight pointing to it
  return {
    ...store,
    annotations: store.annotations
      .filter((a) => a.id !== noteId)
      .map((a) =>
        a.kind === "highlight" && a.noteId === noteId
          ? { ...a, noteId: undefined }
          : a,
      ),
  };
}

export function searchAnnotations(
  store: AnnotationStore,
  query: string,
  publicationId?: string | undefined,
): Annotation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return store.annotations.filter((a) => {
    if (publicationId && a.publicationId !== publicationId) return false;

    if (a.kind === "bookmark") {
      return a.label ? a.label.toLowerCase().includes(q) : false;
    }
    if (a.kind === "highlight") {
      return (
        a.textQuote.exact.toLowerCase().includes(q) ||
        (a.textQuote.prefix?.toLowerCase().includes(q) ?? false) ||
        (a.textQuote.suffix?.toLowerCase().includes(q) ?? false)
      );
    }
    if (a.kind === "note") {
      return a.body.toLowerCase().includes(q);
    }
    return false;
  });
}

export function filterAnnotations(
  store: AnnotationStore,
  criteria: AnnotationFilterCriteria,
): Annotation[] {
  let result = store.annotations;

  if (criteria.publicationId) {
    result = result.filter((a) => a.publicationId === criteria.publicationId);
  }

  if (criteria.kind && criteria.kind !== "all") {
    result = result.filter((a) => a.kind === criteria.kind);
  }

  if (criteria.color) {
    result = result.filter(
      (a) => a.kind === "highlight" && a.color === criteria.color,
    );
  }

  if (criteria.query) {
    const q = criteria.query.trim().toLowerCase();
    result = result.filter((a) => {
      if (a.kind === "bookmark") {
        return a.label ? a.label.toLowerCase().includes(q) : false;
      }
      if (a.kind === "highlight") {
        return (
          a.textQuote.exact.toLowerCase().includes(q) ||
          (a.textQuote.prefix?.toLowerCase().includes(q) ?? false)
        );
      }
      if (a.kind === "note") {
        return a.body.toLowerCase().includes(q);
      }
      return false;
    });
  }

  return result;
}

export function sortAnnotations(
  annotations: Annotation[],
  criteria: AnnotationSortCriteria,
): Annotation[] {
  const sorted = [...annotations];

  sorted.sort((a, b) => {
    if (criteria.field === "createdAt") {
      const cmp = a.createdAt.localeCompare(b.createdAt);
      return criteria.direction === "asc" ? cmp : -cmp;
    }
    if (criteria.field === "updatedAt") {
      const cmp = a.updatedAt.localeCompare(b.updatedAt);
      return criteria.direction === "asc" ? cmp : -cmp;
    }
    if (criteria.field === "location") {
      // Sort by page or section progress
      const getPos = (ann: Annotation): number => {
        if (ann.locator.kind === "pdf") {
          return ann.locator.page;
        }
        return (ann.locator.progress ?? 0) * 1000;
      };
      const cmp = getPos(a) - getPos(b);
      return criteria.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });

  return sorted;
}
