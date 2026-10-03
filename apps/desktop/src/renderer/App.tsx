import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { desktopBridge } from "./adapter/desktop-bridge.js";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { TocDrawer } from "./components/TocDrawer.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { EmptyState } from "./components/EmptyState.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { LibraryView } from "./components/LibraryView.js";
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

  // UI state
  const [tocOpen, setTocOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load library catalog on mount
  useEffect(() => {
    desktopBridge
      .loadLibrary()
      .then((cat) => {
        setCatalog(cat);
      })
      .catch(() => {});
  }, []);

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
    setTocOpen(false);
    setViewMode("library");
  }, []);

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

  // Listen for initial file argument passed from main process (e.g. CLI or test)
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

  // Global keyboard shortcuts (Ctrl+O, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenFile();
      } else if (e.key === "Escape") {
        if (settingsOpen) {
          setSettingsOpen(false);
        } else if (tocOpen) {
          setTocOpen(false);
        } else if (viewMode === "reader") {
          setViewMode("library");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleOpenFile, settingsOpen, tocOpen, viewMode]);

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

      if (!epubPublication || !publicationId) return;
      const sec = epubPublication.readingOrder[newIndex];
      if (!sec) return;

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
    [epubPublication, publicationId],
  );

  // Save position for PDF
  const handlePdfPageChange = useCallback(
    (page: number, total: number) => {
      setCurrentPage(page);
      setTotalPages(total);

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
    [publicationId, pdfZoom],
  );

  const handleTocSelectHref = (href: string) => {
    if (!epubPublication) return;
    const targetIdx = findSectionIndexByHref(
      epubPublication.readingOrder,
      href,
    );
    if (targetIdx >= 0) {
      handleEpubSectionChange(targetIdx);
    }
  };

  // Keyboard navigation for reader
  useEffect(() => {
    if (viewMode !== "reader") return;

    const handleNavKeys = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
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
      } else if (
        e.key === "ArrowRight" ||
        e.key === "PageDown" ||
        e.key === " "
      ) {
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
        theme={settings.theme}
        viewMode={viewMode}
        onOpenFile={handleOpenFile}
        onToggleToc={() => setTocOpen(!tocOpen)}
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
            onProgressChange={handleEpubProgressChange}
            onNavigateSection={handleEpubSectionChange}
          />
        ) : documentKind === "pdf" && pdfBytes ? (
          <PdfViewer
            pdfBytes={pdfBytes}
            currentPage={currentPage}
            zoom={pdfZoom}
            settings={settings}
            onPageChange={handlePdfPageChange}
            onZoomChange={(newZoom) => setPdfZoom(newZoom)}
          />
        ) : (
          <EmptyState theme={settings.theme} onOpenFile={handleOpenFile} />
        )}

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
    </div>
  );
};
