import { describe, it, expect } from "vitest";
import {
  type AnnotationStore,
  type EpubPublicationLocator,
  type PdfPublicationLocator,
  createDefaultAnnotationStore,
  createBookmark,
  deleteBookmark,
  createHighlight,
  updateHighlightColor,
  deleteHighlight,
  createNote,
  updateNoteBody,
  deleteNote,
  searchAnnotations,
  filterAnnotations,
  sortAnnotations,
  matchTextQuote,
} from "@reflowpress/annotations";

describe("Annotations Domain Operations", () => {
  const epubLoc1: EpubPublicationLocator = {
    kind: "epub",
    sectionHref: "chapter1.xhtml",
    progress: 0.15,
  };

  const epubLoc2: EpubPublicationLocator = {
    kind: "epub",
    sectionHref: "chapter2.xhtml",
    progress: 0.45,
  };

  const pdfLoc1: PdfPublicationLocator = {
    kind: "pdf",
    page: 1,
    zoom: 1.0,
  };

  it("creates bookmarks and enforces duplicate bookmark prevention", () => {
    let store: AnnotationStore = createDefaultAnnotationStore();

    // 1. Create first bookmark
    const res1 = createBookmark(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      label: "Chapter 1 Intro",
    });
    store = res1.store;
    expect(res1.isDuplicate).toBe(false);
    expect(store.annotations).toHaveLength(1);
    expect(res1.bookmark.label).toBe("Chapter 1 Intro");

    // 2. Attempt duplicate bookmark at same location
    const res2 = createBookmark(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      label: "Duplicate bookmark",
    });
    expect(res2.isDuplicate).toBe(true);
    expect(res2.store.annotations).toHaveLength(1); // unchanged
    expect(res2.bookmark.id).toBe(res1.bookmark.id);

    // 3. Different location bookmark succeeds
    const res3 = createBookmark(store, {
      publicationId: "book-1",
      locator: epubLoc2,
    });
    store = res3.store;
    expect(res3.isDuplicate).toBe(false);
    expect(store.annotations).toHaveLength(2);

    // 4. Delete bookmark
    store = deleteBookmark(store, res1.bookmark.id);
    expect(store.annotations).toHaveLength(1);
    expect(store.annotations[0]?.id).toBe(res3.bookmark.id);
  });

  it("creates highlights, updates colors, and deletes cleanly", () => {
    let store = createDefaultAnnotationStore();

    const { store: s1, highlight } = createHighlight(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      color: "yellow",
      textQuote: { exact: "Call me Ishmael." },
    });
    store = s1;

    expect(highlight.color).toBe("yellow");
    expect(highlight.textQuote.exact).toBe("Call me Ishmael.");
    expect(highlight.status).toBe("active");

    // Update color
    store = updateHighlightColor(store, highlight.id, "blue");
    const updatedH = store.annotations.find((a) => a.id === highlight.id);
    expect(updatedH?.kind === "highlight" && updatedH.color).toBe("blue");

    // Delete highlight
    store = deleteHighlight(store, highlight.id);
    expect(store.annotations).toHaveLength(0);
  });

  it("creates notes, edits bodies, and manages links to highlights", () => {
    let store = createDefaultAnnotationStore();

    // 1. Create a highlight first
    const { store: s1, highlight } = createHighlight(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      color: "green",
      textQuote: { exact: "Famous opening line." },
    });
    store = s1;

    // 2. Create note attached to highlight
    const { store: s2, note } = createNote(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      body: "Important literary quote to remember.",
      highlightId: highlight.id,
    });
    store = s2;

    expect(note.highlightId).toBe(highlight.id);
    expect(note.body).toBe("Important literary quote to remember.");

    // The highlight should also reference noteId
    const linkedH = store.annotations.find((a) => a.id === highlight.id);
    expect(linkedH?.kind === "highlight" && linkedH.noteId).toBe(note.id);

    // 3. Edit note body
    store = updateNoteBody(store, note.id, "Updated literary quote.");
    const updatedNote = store.annotations.find((a) => a.id === note.id);
    expect(updatedNote?.kind === "note" && updatedNote.body).toBe(
      "Updated literary quote.",
    );

    // 4. Deleting note detaches noteId from highlight without deleting highlight
    store = deleteNote(store, note.id);
    expect(store.annotations.some((a) => a.id === note.id)).toBe(false);
    const preservedH = store.annotations.find((a) => a.id === highlight.id);
    expect(preservedH).toBeDefined();
    expect(
      preservedH?.kind === "highlight" && preservedH.noteId,
    ).toBeUndefined();
  });

  it("searches and filters across annotations store", () => {
    let store = createDefaultAnnotationStore();

    const { store: s1 } = createBookmark(store, {
      publicationId: "book-1",
      locator: epubLoc1,
      label: "Important Section",
    });
    const { store: s2 } = createHighlight(s1, {
      publicationId: "book-1",
      locator: epubLoc2,
      color: "pink",
      textQuote: { exact: "Quantum mechanics is fascinating." },
    });
    const { store: s3 } = createNote(s2, {
      publicationId: "book-1",
      locator: pdfLoc1,
      body: "Check references on gravity and relativity.",
    });
    store = s3;

    // Search query matches highlight quote
    expect(searchAnnotations(store, "quantum")).toHaveLength(1);
    // Search query matches note body
    expect(searchAnnotations(store, "relativity")).toHaveLength(1);
    // Search query matches bookmark label
    expect(searchAnnotations(store, "important")).toHaveLength(1);
    // No match
    expect(searchAnnotations(store, "nonexistent")).toHaveLength(0);

    // Filter by kind
    expect(filterAnnotations(store, { kind: "highlight" })).toHaveLength(1);
    expect(filterAnnotations(store, { kind: "bookmark" })).toHaveLength(1);
    expect(filterAnnotations(store, { kind: "note" })).toHaveLength(1);

    // Filter by color
    expect(filterAnnotations(store, { color: "pink" })).toHaveLength(1);
    expect(filterAnnotations(store, { color: "yellow" })).toHaveLength(0);
  });

  it("sorts annotations by date and position", () => {
    let store = createDefaultAnnotationStore();
    const { store: s1, bookmark: b1 } = createBookmark(store, {
      publicationId: "book-1",
      locator: { kind: "pdf", page: 10 },
    });
    const { store: s2, bookmark: b2 } = createBookmark(s1, {
      publicationId: "book-1",
      locator: { kind: "pdf", page: 2 },
    });
    store = s2;

    const byLocationAsc = sortAnnotations(store.annotations, {
      field: "location",
      direction: "asc",
    });
    expect(byLocationAsc[0]?.id).toBe(b2.id); // page 2
    expect(byLocationAsc[1]?.id).toBe(b1.id); // page 10
  });
});

describe("TextQuote Anchoring and Disambiguation Engine", () => {
  const sampleDoc =
    "In the beginning was the Word. The Word was with God, and the Word was God. He was in the beginning with God.";

  it("matches exact text quotes with position fast path", () => {
    const selector = {
      exact: "The Word was with God",
      prefix: "the Word. ",
      suffix: ", and",
    };
    const hint = { start: 31, end: 52 };

    const res = matchTextQuote(sampleDoc, selector, hint);
    expect(res.status).toBe("matched");
    expect(res.confidence).toBe(1.0);
    expect(res.range).toEqual({ start: 31, end: 52 });
  });

  it("disambiguates duplicate occurrences using prefix and suffix", () => {
    // "the beginning" appears twice in sampleDoc:
    // 1: index 7 ("In the beginning was")
    // 2: index 86 ("in the beginning with")
    const selector = {
      exact: "the beginning",
      prefix: "He was in ",
      suffix: " with God.",
    };

    const res = matchTextQuote(sampleDoc, selector);
    expect(res.status).toBe("matched");
    expect(res.range?.start).toBe(86);
  });

  it("marks quotes not found in modified content as orphaned without data loss", () => {
    const selector = {
      exact: "Completely deleted sentence from revised edition.",
    };
    const res = matchTextQuote(sampleDoc, selector);
    expect(res.status).toBe("orphaned");
    expect(res.range).toBeUndefined();
  });

  it("handles Japanese, CJK, and Unicode text quotes", () => {
    const japaneseText =
      "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。";
    const selector = {
      exact: "名前はまだ無い",
      prefix: "吾輩は猫である。",
      suffix: "。どこで",
    };

    const res = matchTextQuote(japaneseText, selector);
    expect(res.status).toBe("matched");
    expect(japaneseText.slice(res.range!.start, res.range!.end)).toBe(
      "名前はまだ無い",
    );
  });

  it("handles multiline text quotes across paragraph breaks", () => {
    const multilineDoc =
      "First paragraph content.\n\nSecond paragraph content.";
    const selector = {
      exact: "content.\n\nSecond paragraph",
    };

    const res = matchTextQuote(multilineDoc, selector);
    expect(res.status).toBe("matched");
    expect(res.range?.start).toBe(16);
  });
});
