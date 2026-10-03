import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import type { NormalizedPublication } from "@reflowpress/core";
import {
  type ReaderSettings,
  type SavedReadingPosition,
  DEFAULT_READER_SETTINGS,
  DEFAULT_PDF_ZOOM,
  clampPdfZoom,
  findSectionIndexByHref,
} from "@reflowpress/reader";
import {
  type LibraryCatalog,
  type LibraryBook,
  createDefaultCatalog,
} from "@reflowpress/library";
import {
  type AnnotationColor,
  type AnnotationStore,
  type HighlightAnnotation,
  type PublicationLocator,
  type PublicationIdentity,
  createDefaultAnnotationStore,
  createBookmark,
  createHighlight,
  createNote,
} from "@reflowpress/annotations";
import {
  type SearchProgress,
  type SearchResult,
  searchEpubSections,
  searchPdfPages,
} from "@reflowpress/search";
import { resolveWritingMode } from "@reflowpress/typography";
import { desktopBridge } from "./adapter/desktop-bridge.js";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { TocDrawer } from "./components/TocDrawer.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { EmptyState } from "./components/EmptyState.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { LibraryView } from "./components/LibraryView.js";
import { ReadingToolsDrawer } from "./components/ReadingToolsDrawer.js";
import { SelectionToolbar } from "./components/SelectionToolbar.js";
import { EpubViewer } from "./reader/EpubViewer.js";
import { PdfViewer } from "./reader/PdfViewer.js";

const SETTINGS_STORAGE_KEY = "reflowpress:reader-settings";

function loadSavedSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_READER_SETTINGS;
}

export const App: React.FC = () => {
  const [settings, setSettings] = useState<ReaderSettings>(loadSavedSettings);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // View state: 'library' or 'reader'
  const [viewMode, setViewMode] = useState<"library" | "reader">("library");

  // Library Catalog state
  const [catalog, setCatalog] = useState<LibraryCatalog>(createDefaultCatalog);

  // Annotations state
  const [annotationStore, setAnnotationStore] = useState<AnnotationStore>(
    createDefaultAnnotationStore,
  );

  // Active document state
  const [documentKind, setDocumentKind] = useState<"epub" | "pdf" | null>(null);
  const [publicationId, setPublicationId] = useState<string>("");
  const [documentTitle, setDocumentTitle] = useState<string>("");

  // EPUB specific state
  const [epubPublication, setEpubPublication] =
    useState<NormalizedPublication | null>(null);
  const [activeSectionIndex, setActiveSectionIndex] = useState<number>(0);
  const [sectionProgress, setSectionProgress] = useState<number>(0);
  const [initialProgress, setInitialProgress] = useState<number>(0);

  // PDF specific state
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pdfZoom, setPdfZoom] = useState<number>(DEFAULT_PDF_ZOOM);
  const [pdfPagesText, setPdfPagesText] = useState<
    Array<{ page: number; text: string }>
  >([]);

  // UI state
  const [tocOpen, setTocOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [toolsDrawerOpen, setToolsDrawerOpen] = useState<boolean>(false);
  const [activeToolsTab, setActiveToolsTab] = useState<
    "search" | "bookmarks" | "highlights" | "notes"
  >("search");

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchProgress, setSearchProgress] = useState<
    SearchProgress | undefined
  >(undefined);
  const [searchTarget, setSearchTarget] = useState<{
    textQuote: { exact: string; prefix?: string; suffix?: string };
  } | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Text Selection state
  const [currentSelection, setCurrentSelection] = useState<{
    text: string;
    prefix?: string | undefined;
    suffix?: string | undefined;
    page?: number | undefined;
  } | null>(null);

  // Screen reader polite live status announcer
  const [srAnnouncement, setSrAnnouncement] = useState<string>("");
  const announce = useCallback((message: string) => {
    setSrAnnouncement(message);
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load library catalog and annotations on mount
  useEffect(() => {
    desktopBridge
      .loadLibrary()
      .then((cat) => setCatalog(cat))
      .catch(() => {});

    desktopBridge
      .loadAnnotations()
      .then((store) => setAnnotationStore(store))
      .catch(() => {});
  }, []);

  // Save annotation store helper
  const handleSaveAnnotationStore = useCallback(
    async (newStore: AnnotationStore) => {
      setAnnotationStore(newStore);
      await desktopBridge.saveAnnotations(newStore);
    },
    [],
  );

  // Current reading locator
  const currentLocator = useMemo<PublicationLocator>(() => {
    if (documentKind === "pdf") {
      return {
        kind: "pdf",
        page: currentPage,
        zoom: pdfZoom,
      };
    }
    const currentHref =
      epubPublication?.readingOrder[activeSectionIndex]?.href || "";
    return {
      kind: "epub",
      sectionHref: currentHref,
      progress: Math.round(sectionProgress * 1000) / 1000,
    };
  }, [
    documentKind,
    currentPage,
    pdfZoom,
    epubPublication,
    activeSectionIndex,
    sectionProgress,
  ]);

  // Persist settings changes
  const handleUpdateSettings = (newSettings: ReaderSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch {
      // Ignore
    }
  };

  const handleCloseDocument = useCallback(() => {
    setDocumentKind(null);
    setPublicationId("");
    setDocumentTitle("");
    setEpubPublication(null);
    setPdfBytes(null);
    setPdfPagesText([]);
    setTocOpen(false);
    setToolsDrawerOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchTarget(null);
    setCurrentSelection(null);
    setViewMode("library");
  }, []);

  // Full-text in-book search effect
  useEffect(() => {
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    const q = searchQuery.trim();
    if (!q || !publicationId) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const abortController = new AbortController();
    searchAbortRef.current = abortController;
    setIsSearching(true);

    const timer = setTimeout(() => {
      try {
        if (documentKind === "epub" && epubPublication) {
          const sections = epubPublication.readingOrder.map((s) => ({
            href: s.href,
            title: s.title,
            content: s.markup,
          }));
          const results = searchEpubSections(
            publicationId,
            sections,
            q,
            undefined,
            setSearchProgress,
            abortController.signal,
          );
          if (!abortController.signal.aborted) {
            setSearchResults(results);
          }
        } else if (documentKind === "pdf" && pdfPagesText.length > 0) {
          const results = searchPdfPages(
            publicationId,
            pdfPagesText,
            q,
            undefined,
            setSearchProgress,
            abortController.signal,
          );
          if (!abortController.signal.aborted) {
            setSearchResults(results);
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 120);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [searchQuery, publicationId, documentKind, epubPublication, pdfPagesText]);

  // Jump to any publication locator (search result, bookmark, highlight, note)
  const handleJumpToLocator = useCallback(
    (loc: PublicationLocator) => {
      if (loc.kind === "epub") {
        if (epubPublication) {
          const found = findSectionIndexByHref(
            epubPublication.readingOrder,
            loc.sectionHref,
          );
          if (found >= 0) {
            setActiveSectionIndex(found);
            if (loc.progress !== undefined) {
              setInitialProgress(loc.progress);
            }
            if (loc.textQuote) {
              setSearchTarget({ textQuote: loc.textQuote });
            }
          }
        }
      } else if (loc.kind === "pdf") {
        setCurrentPage(loc.page);
      }
    },
    [epubPublication],
  );

  // Quick bookmark current location
  const handleQuickBookmark = useCallback(async () => {
    if (!publicationId) return;
    const { store: updated, isDuplicate } = createBookmark(annotationStore, {
      publicationId,
      locator: currentLocator,
    });
    if (!isDuplicate) {
      await handleSaveAnnotationStore(updated);
    }
    setActiveToolsTab("bookmarks");
    setToolsDrawerOpen(true);
    setTocOpen(false);
  }, [
    publicationId,
    currentLocator,
    annotationStore,
    handleSaveAnnotationStore,
  ]);

  // Highlight creation from selection
  const handleCreateHighlight = useCallback(
    async (color: AnnotationColor) => {
      if (!currentSelection || !publicationId) return;
      const loc: PublicationLocator =
        documentKind === "pdf"
          ? {
              kind: "pdf",
              page: currentSelection.page || currentPage,
              textQuote: { exact: currentSelection.text },
            }
          : {
              kind: "epub",
              sectionHref:
                epubPublication?.readingOrder[activeSectionIndex]?.href || "",
              progress: sectionProgress,
              textQuote: {
                exact: currentSelection.text,
                prefix: currentSelection.prefix,
                suffix: currentSelection.suffix,
              },
            };

      const { store: updated } = createHighlight(annotationStore, {
        publicationId,
        locator: loc,
        color,
        textQuote: {
          exact: currentSelection.text,
          prefix: currentSelection.prefix,
          suffix: currentSelection.suffix,
        },
      });

      await handleSaveAnnotationStore(updated);
      setCurrentSelection(null);
    },
    [
      currentSelection,
      publicationId,
      documentKind,
      currentPage,
      epubPublication,
      activeSectionIndex,
      sectionProgress,
      annotationStore,
      handleSaveAnnotationStore,
    ],
  );

  // Add Note from selection
  const handleAddNoteFromSelection = useCallback(
    async (color: AnnotationColor) => {
      if (!currentSelection || !publicationId) return;
      const loc: PublicationLocator =
        documentKind === "pdf"
          ? {
              kind: "pdf",
              page: currentSelection.page || currentPage,
              textQuote: { exact: currentSelection.text },
            }
          : {
              kind: "epub",
              sectionHref:
                epubPublication?.readingOrder[activeSectionIndex]?.href || "",
              progress: sectionProgress,
              textQuote: {
                exact: currentSelection.text,
                prefix: currentSelection.prefix,
                suffix: currentSelection.suffix,
              },
            };

      const { store: withHighlight, highlight } = createHighlight(
        annotationStore,
        {
          publicationId,
          locator: loc,
          color,
          textQuote: {
            exact: currentSelection.text,
            prefix: currentSelection.prefix,
            suffix: currentSelection.suffix,
          },
        },
      );

      const noteText = window.prompt("Enter note for this text:", "");
      if (noteText && noteText.trim()) {
        const { store: withNote } = createNote(withHighlight, {
          publicationId,
          locator: loc,
          body: noteText.trim(),
          highlightId: highlight.id,
        });
        await handleSaveAnnotationStore(withNote);
      } else {
        await handleSaveAnnotationStore(withHighlight);
      }
      setCurrentSelection(null);
    },
    [
      currentSelection,
      publicationId,
      documentKind,
      currentPage,
      epubPublication,
      activeSectionIndex,
      sectionProgress,
      annotationStore,
      handleSaveAnnotationStore,
    ],
  );

  // Export annotations handler
  const handleExportAnnotations = useCallback(
    async (format: "json" | "markdown" | "html") => {
      const pubIdentity: PublicationIdentity = {
        identifier: publicationId,
        title: documentTitle,
        format: (documentKind || "epub") as "epub" | "pdf",
      };
      const ext =
        format === "json" ? "json" : format === "markdown" ? "md" : "html";
      const cleanTitle = documentTitle.replace(
        /[^a-zA-Z0-9_\-\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g,
        "_",
      );
      const defaultName = `${cleanTitle}-annotations.${ext}`;

      const targetPath = await desktopBridge.showSaveFileDialog({
        title: `Export Annotations (${format.toUpperCase()})`,
        defaultPath: defaultName,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      });

      if (targetPath) {
        await desktopBridge.exportAnnotations(
          pubIdentity,
          format,
          targetPath,
          publicationId,
        );
      }
    },
    [publicationId, documentTitle, documentKind],
  );

  // Import annotations handler
  const handleImportAnnotations = useCallback(async () => {
    const sourcePath = await desktopBridge.showOpenAnnotationFileDialog();
    if (sourcePath) {
      await desktopBridge.importAnnotations(sourcePath, publicationId);
      const reloaded = await desktopBridge.loadAnnotations();
      setAnnotationStore(reloaded);
    }
  }, [publicationId]);

  const loadFile = useCallback(
    async (filePath: string) => {
      setIsLoading(true);
      setErrorMessage(null);
      setLoadingMessage(`Loading ${filePath.split(/[/\\]/).pop()}...`);

      try {
        const res = await desktopBridge.loadPublication(filePath);

        if (res.kind === "epub" && res.publication) {
          setDocumentKind("epub");
          setPublicationId(res.publicationId);
          setDocumentTitle(res.title);
          setEpubPublication(res.publication);

          // Check for saved reading position
          let restoredSection = 0;
          let restoredProgress = 0;
          try {
            const saved = await desktopBridge.loadReadingPosition(
              res.publicationId,
            );
            if (saved && saved.location.kind === "epub") {
              const foundIndex = findSectionIndexByHref(
                res.publication.readingOrder,
                saved.location.sectionHref,
              );
              if (foundIndex >= 0) {
                restoredSection = foundIndex;
              }
              restoredProgress = saved.location.progress || 0;
            }
          } catch {
            // ignore position restore errors
          }

          setActiveSectionIndex(restoredSection);
          setInitialProgress(restoredProgress);
          setSectionProgress(restoredProgress);
          setPdfBytes(null);
          setPdfPagesText([]);
          setViewMode("reader");
        } else if (res.kind === "pdf") {
          setDocumentKind("pdf");
          setPublicationId(res.publicationId);
          setDocumentTitle(res.title);
          setEpubPublication(null);

          const bytes = await desktopBridge.readPdfBytes(filePath);
          setPdfBytes(bytes);

          // Check for saved position
          let restoredPage = 1;
          let restoredZoom = DEFAULT_PDF_ZOOM;
          try {
            const saved = await desktopBridge.loadReadingPosition(
              res.publicationId,
            );
            if (saved && saved.location.kind === "pdf") {
              restoredPage = saved.location.page || 1;
              restoredZoom = clampPdfZoom(
                saved.location.zoom || DEFAULT_PDF_ZOOM,
              );
            }
          } catch {
            // ignore
          }

          setCurrentPage(restoredPage);
          setPdfZoom(restoredZoom);
          setViewMode("reader");
        }

        // Add file to library catalog in background
        desktopBridge
          .scanLibraryPaths([filePath])
          .then(({ catalog: updated }) => {
            setCatalog(updated);
          })
          .catch(() => {});
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load publication.",
        );
        handleCloseDocument();
      } finally {
        setIsLoading(false);
        setLoadingMessage("");
      }
    },
    [handleCloseDocument],
  );

  const handleOpenFile = useCallback(async () => {
    try {
      const selectedPath = await desktopBridge.openFileDialog();
      if (selectedPath) {
        await loadFile(selectedPath);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not open file.",
      );
    }
  }, [loadFile]);

  // Library Action Handlers
  const handleAddFiles = useCallback(async () => {
    try {
      const files = await desktopBridge.openMultipleFilesDialog();
      if (files.length > 0) {
        setIsLoading(true);
        setLoadingMessage(`Indexing ${files.length} publication(s)...`);
        const { catalog: updated } =
          await desktopBridge.scanLibraryPaths(files);
        setCatalog(updated);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to add files.",
      );
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  }, []);

  const handleAddFolder = useCallback(async () => {
    try {
      const dir = await desktopBridge.openDirectoryDialog();
      if (dir) {
        setIsLoading(true);
        setLoadingMessage(`Scanning folder for publications...`);
        const { catalog: updated } = await desktopBridge.scanLibraryPaths([
          dir,
        ]);
        setCatalog(updated);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to scan folder.",
      );
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  }, []);

  const handleOpenBook = useCallback(
    async (book: LibraryBook) => {
      await loadFile(book.filePath);
      desktopBridge
        .updateBookInLibrary(book.id, { lastOpened: new Date().toISOString() })
        .then((updated) => setCatalog(updated))
        .catch(() => {});
    },
    [loadFile],
  );

  const handleRemoveBook = useCallback(async (bookId: string) => {
    try {
      const updated = await desktopBridge.removeBookFromLibrary(bookId);
      setCatalog(updated);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to remove book.",
      );
    }
  }, []);

  const handleCreateCollection = useCallback(async (name: string) => {
    try {
      const updated = await desktopBridge.createLibraryCollection(name);
      setCatalog(updated);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create collection.",
      );
    }
  }, []);

  const handleDeleteCollection = useCallback(async (collectionId: string) => {
    try {
      const updated = await desktopBridge.deleteLibraryCollection(collectionId);
      setCatalog(updated);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to delete collection.",
      );
    }
  }, []);

  const handleAddBookToCollection = useCallback(
    async (bookId: string, collectionId: string) => {
      try {
        const updated = await desktopBridge.addBookToLibraryCollection(
          bookId,
          collectionId,
        );
        setCatalog(updated);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to add book to collection.",
        );
      }
    },
    [],
  );

  const handleRemoveBookFromCollection = useCallback(
    async (bookId: string, collectionId: string) => {
      try {
        const updated = await desktopBridge.removeBookFromLibraryCollection(
          bookId,
          collectionId,
        );
        setCatalog(updated);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Failed to remove book from collection.",
        );
      }
    },
    [],
  );

  const handleTocSelectHref = useCallback(
    (href: string) => {
      if (!epubPublication) return;
      const index = findSectionIndexByHref(epubPublication.readingOrder, href);
      if (index >= 0) {
        setActiveSectionIndex(index);
        setSectionProgress(0);
        setInitialProgress(0);
        setTocOpen(false);
      }
    },
    [epubPublication],
  );

  // Handle initial file argument if passed from main process
  useEffect(() => {
    let isCancelled = false;
    desktopBridge
      .getInitialFile?.()
      .then((initialPath) => {
        if (!isCancelled && initialPath) {
          loadFile(initialPath);
        }
      })
      .catch(() => {});

    const unsubscribe = desktopBridge.onOpenInitialFile?.((path) => {
      loadFile(path);
    });
    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [loadFile]);

  // Global keyboard shortcuts (Ctrl+O, Ctrl+F, Ctrl+D, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (viewMode === "reader" && documentKind !== null) {
          setActiveToolsTab("search");
          setToolsDrawerOpen(true);
          setTocOpen(false);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (viewMode === "reader" && documentKind !== null) {
          handleQuickBookmark();
        }
      } else if (e.key === "Escape") {
        if (settingsOpen) {
          setSettingsOpen(false);
        } else if (toolsDrawerOpen) {
          setToolsDrawerOpen(false);
        } else if (tocOpen) {
          setTocOpen(false);
        } else if (currentSelection) {
          setCurrentSelection(null);
        } else if (viewMode === "reader") {
          setViewMode("library");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    handleOpenFile,
    handleQuickBookmark,
    settingsOpen,
    toolsDrawerOpen,
    tocOpen,
    currentSelection,
    viewMode,
    documentKind,
  ]);

  // Debounced save position for EPUB
  const handleEpubProgressChange = useCallback(
    (secIndex: number, progress: number) => {
      setSectionProgress(progress);
      if (!epubPublication || !publicationId) return;

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        const sec = epubPublication.readingOrder[secIndex];
        if (!sec) return;

        const pos: SavedReadingPosition = {
          publicationId,
          location: {
            kind: "epub",
            sectionId: sec.id,
            sectionHref: sec.href,
            progress,
          },
          updatedAt: new Date().toISOString(),
        };

        desktopBridge.saveReadingPosition(pos).catch(() => {});
      }, 500);
    },
    [epubPublication, publicationId],
  );

  const handleEpubSectionChange = useCallback(
    (newIndex: number) => {
      setActiveSectionIndex(newIndex);
      setSectionProgress(0);
      setInitialProgress(0);
      setSearchTarget(null);

      if (!epubPublication || !publicationId) return;
      const sec = epubPublication.readingOrder[newIndex];
      if (!sec) return;

      announce(
        `Section ${newIndex + 1} of ${epubPublication.readingOrder.length}: ${sec.title || sec.id}`,
      );

      const pos: SavedReadingPosition = {
        publicationId,
        location: {
          kind: "epub",
          sectionId: sec.id,
          sectionHref: sec.href,
          progress: 0,
        },
        updatedAt: new Date().toISOString(),
      };
      desktopBridge.saveReadingPosition(pos).catch(() => {});
    },
    [epubPublication, publicationId, announce],
  );

  // Save position for PDF
  const handlePdfPageChange = useCallback(
    (page: number, total: number) => {
      setCurrentPage(page);
      setTotalPages(total);

      announce(`Page ${page} of ${total}`);

      if (!publicationId) return;
      const pos: SavedReadingPosition = {
        publicationId,
        location: {
          kind: "pdf",
          page,
          zoom: pdfZoom,
        },
        updatedAt: new Date().toISOString(),
      };
      desktopBridge.saveReadingPosition(pos).catch(() => {});
    },
    [publicationId, pdfZoom, announce],
  );

  const writingModeSetting = settings.writingMode ?? "auto";
  const resolvedWritingMode = useMemo(() => {
    return resolveWritingMode(writingModeSetting, {
      pageProgressionDirection:
        epubPublication?.metadata.direction === "rtl" ? "rtl" : undefined,
      renditionDirection:
        epubPublication?.metadata.direction === "rtl" ? "rtl" : undefined,
      markupSnippet: epubPublication?.readingOrder[
        activeSectionIndex
      ]?.markup.slice(0, 3000),
    });
  }, [writingModeSetting, epubPublication, activeSectionIndex]);

  // Arrow / Page / Space Navigation for desktop window with writing-mode awareness
  useEffect(() => {
    const handleNavKeys = (e: KeyboardEvent) => {
      if (viewMode !== "reader") return;
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "SELECT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isVertical = resolvedWritingMode === "vertical-rl";
      const isNext =
        (isVertical ? e.key === "ArrowLeft" : e.key === "ArrowRight") ||
        e.key === "PageDown" ||
        (e.key === " " && !e.shiftKey);

      const isPrev =
        (isVertical ? e.key === "ArrowRight" : e.key === "ArrowLeft") ||
        e.key === "PageUp" ||
        (e.key === " " && e.shiftKey);

      if (isNext) {
        e.preventDefault();
        if (documentKind === "epub") {
          if (
            epubPublication &&
            activeSectionIndex < epubPublication.readingOrder.length - 1
          ) {
            handleEpubSectionChange(activeSectionIndex + 1);
          }
        } else if (documentKind === "pdf") {
          if (currentPage < totalPages) {
            handlePdfPageChange(currentPage + 1, totalPages);
          }
        }
      } else if (isPrev) {
        e.preventDefault();
        if (documentKind === "epub") {
          if (activeSectionIndex > 0) {
            handleEpubSectionChange(activeSectionIndex - 1);
          }
        } else if (documentKind === "pdf") {
          if (currentPage > 1) {
            handlePdfPageChange(currentPage - 1, totalPages);
          }
        }
      }
    };

    window.addEventListener("keydown", handleNavKeys);
    return () => {
      window.removeEventListener("keydown", handleNavKeys);
    };
  }, [
    viewMode,
    documentKind,
    activeSectionIndex,
    epubPublication,
    currentPage,
    totalPages,
    resolvedWritingMode,
    handleEpubSectionChange,
    handlePdfPageChange,
  ]);

  // Determine progress labels
  let progressLabel = "";
  let progressPercent = 0;
  let canGoPrevious = false;
  let canGoNext = false;

  if (documentKind === "epub" && epubPublication) {
    const totalSections = epubPublication.readingOrder.length;
    const currentSectionNum = activeSectionIndex + 1;
    const activeSection = epubPublication.readingOrder[activeSectionIndex];
    const sectionTitle =
      activeSection?.title ||
      `Section ${currentSectionNum} of ${totalSections}`;

    progressLabel = `${sectionTitle} (${Math.round(sectionProgress * 100)}%)`;
    progressPercent =
      totalSections > 0
        ? Math.round(
            ((activeSectionIndex + sectionProgress) / totalSections) * 100,
          )
        : 0;
    canGoPrevious = activeSectionIndex > 0;
    canGoNext = activeSectionIndex < totalSections - 1;
  } else if (documentKind === "pdf") {
    progressLabel = `Page ${currentPage} of ${totalPages}`;
    progressPercent =
      totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
    canGoPrevious = currentPage > 1;
    canGoNext = currentPage < totalPages;
  }

  const isDark = settings.theme === "dark";
  const isSepia = settings.theme === "sepia";
  const appBg = isDark ? "#121212" : isSepia ? "#fbf0d9" : "#f9fafb";

  const pubHighlights = useMemo(
    () =>
      annotationStore.annotations.filter(
        (a): a is HighlightAnnotation =>
          a.publicationId === publicationId && a.kind === "highlight",
      ),
    [annotationStore, publicationId],
  );

  return (
    <div
      className={`reader-shell theme-${settings.theme}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: appBg,
      }}
    >
      <Header
        title={
          viewMode === "reader" && documentTitle
            ? documentTitle
            : "ReflowPress Workbench"
        }
        hasDocument={documentKind !== null}
        hasToc={
          documentKind === "epub" &&
          Boolean(
            epubPublication?.navigation &&
            epubPublication.navigation.length > 0,
          )
        }
        tocOpen={tocOpen}
        toolsOpen={toolsDrawerOpen}
        theme={settings.theme}
        viewMode={viewMode}
        onOpenFile={handleOpenFile}
        onToggleToc={() => {
          setTocOpen(!tocOpen);
          if (!tocOpen) setToolsDrawerOpen(false);
        }}
        onToggleTools={() => {
          setToolsDrawerOpen(!toolsDrawerOpen);
          if (!toolsDrawerOpen) setTocOpen(false);
        }}
        onToggleSearch={() => {
          setActiveToolsTab("search");
          setToolsDrawerOpen(true);
          setTocOpen(false);
        }}
        onQuickBookmark={handleQuickBookmark}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseDocument={handleCloseDocument}
        onSwitchToLibrary={() => setViewMode("library")}
        onSwitchToReader={() => setViewMode("reader")}
      />

      {errorMessage && (
        <ErrorBanner
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      )}

      {isLoading && (
        <div
          className="loading-overlay"
          style={{
            position: "absolute",
            top: "48px",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            color: "#ffffff",
            fontSize: "16px",
            userSelect: "none",
          }}
        >
          <div
            style={{
              padding: "20px 32px",
              backgroundColor: isDark ? "#1f2937" : "#374151",
              borderRadius: "8px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            }}
          >
            {loadingMessage || "Loading..."}
          </div>
        </div>
      )}

      <main
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {viewMode === "library" ? (
          <LibraryView
            catalog={catalog}
            theme={settings.theme}
            onOpenBook={handleOpenBook}
            onAddFiles={handleAddFiles}
            onAddFolder={handleAddFolder}
            onRemoveBook={handleRemoveBook}
            onCreateCollection={handleCreateCollection}
            onDeleteCollection={handleDeleteCollection}
            onAddBookToCollection={handleAddBookToCollection}
            onRemoveBookFromCollection={handleRemoveBookFromCollection}
          />
        ) : documentKind === "epub" && epubPublication ? (
          <EpubViewer
            publication={epubPublication}
            activeSectionIndex={activeSectionIndex}
            initialProgress={initialProgress}
            settings={settings}
            highlights={pubHighlights}
            searchTarget={searchTarget}
            onProgressChange={handleEpubProgressChange}
            onSectionChange={handleEpubSectionChange}
            onSelectionChange={(sel) => setCurrentSelection(sel)}
          />
        ) : documentKind === "pdf" && pdfBytes ? (
          <PdfViewer
            pdfBytes={pdfBytes}
            currentPage={currentPage}
            zoom={pdfZoom}
            settings={settings}
            highlights={pubHighlights}
            onPageChange={handlePdfPageChange}
            onZoomChange={(newZoom) => setPdfZoom(newZoom)}
            onPagesExtracted={(pages) => setPdfPagesText(pages)}
            onSelectionChange={(sel) =>
              setCurrentSelection(
                sel ? { text: sel.text, page: sel.page } : null,
              )
            }
          />
        ) : (
          <EmptyState theme={settings.theme} onOpenFile={handleOpenFile} />
        )}

        {/* Floating Context Toolbar for Text Selection */}
        <SelectionToolbar
          visible={currentSelection !== null}
          selectedText={currentSelection?.text || ""}
          theme={settings.theme}
          onHighlight={handleCreateHighlight}
          onAddNote={handleAddNoteFromSelection}
          onDismiss={() => setCurrentSelection(null)}
        />

        {/* TOC Drawer */}
        {viewMode === "reader" &&
          documentKind === "epub" &&
          epubPublication && (
            <TocDrawer
              isOpen={tocOpen}
              items={epubPublication.navigation || []}
              currentHref={
                epubPublication.readingOrder[activeSectionIndex]?.href || ""
              }
              theme={settings.theme}
              onClose={() => setTocOpen(false)}
              onSelectHref={handleTocSelectHref}
            />
          )}

        {/* Reading Tools Drawer (Search, Bookmarks, Highlights, Notes, Export/Import) */}
        {viewMode === "reader" && documentKind !== null && (
          <ReadingToolsDrawer
            isOpen={toolsDrawerOpen}
            activeTab={activeToolsTab}
            onTabChange={setActiveToolsTab}
            onClose={() => setToolsDrawerOpen(false)}
            theme={settings.theme}
            publicationId={publicationId}
            publicationTitle={documentTitle}
            publicationFormat={documentKind}
            store={annotationStore}
            onSaveStore={handleSaveAnnotationStore}
            currentLocator={currentLocator}
            onJumpToLocator={handleJumpToLocator}
            searchResults={searchResults}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            isSearching={isSearching}
            searchProgress={searchProgress}
            onExport={handleExportAnnotations}
            onImport={handleImportAnnotations}
          />
        )}
      </main>

      {viewMode === "reader" && documentKind !== null && (
        <Footer
          progressLabel={progressLabel}
          progressPercent={progressPercent}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          theme={settings.theme}
          onPrevious={() => {
            if (documentKind === "epub") {
              if (activeSectionIndex > 0)
                handleEpubSectionChange(activeSectionIndex - 1);
            } else if (documentKind === "pdf") {
              if (currentPage > 1)
                handlePdfPageChange(currentPage - 1, totalPages);
            }
          }}
          onNext={() => {
            if (documentKind === "epub") {
              if (
                epubPublication &&
                activeSectionIndex < epubPublication.readingOrder.length - 1
              ) {
                handleEpubSectionChange(activeSectionIndex + 1);
              }
            } else if (documentKind === "pdf") {
              if (currentPage < totalPages)
                handlePdfPageChange(currentPage + 1, totalPages);
            }
          }}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* Screen Reader Live Status Region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {srAnnouncement}
      </div>
    </div>
  );
};
