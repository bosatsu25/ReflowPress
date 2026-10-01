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
import { desktopBridge } from "./adapter/desktop-bridge.js";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { TocDrawer } from "./components/TocDrawer.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { EmptyState } from "./components/EmptyState.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
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
        }
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
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleOpenFile, settingsOpen, tocOpen]);

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
    (newPage: number, total: number) => {
      setCurrentPage(newPage);
      setTotalPages(total);

      if (!publicationId) return;

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        const pos: SavedReadingPosition = {
          publicationId,
          location: {
            kind: "pdf",
            page: newPage,
            zoom: pdfZoom,
          },
          updatedAt: new Date().toISOString(),
        };
        desktopBridge.saveReadingPosition(pos).catch(() => {});
      }, 500);
    },
    [publicationId, pdfZoom],
  );

  // Jump via TOC
  const handleTocSelectHref = useCallback(
    (href: string) => {
      if (documentKind === "epub" && epubPublication) {
        const index = findSectionIndexByHref(
          epubPublication.readingOrder,
          href,
        );
        if (index !== -1) {
          handleEpubSectionChange(index);
        }
      }
    },
    [documentKind, epubPublication, handleEpubSectionChange],
  );

  // Calculate footer labels and progress
  let progressLabel = "";
  let progressPercent = 0;
  let canGoPrevious = false;
  let canGoNext = false;

  if (documentKind === "epub" && epubPublication) {
    const totalSecs = epubPublication.readingOrder.length;
    canGoPrevious = activeSectionIndex > 0;
    canGoNext = activeSectionIndex < totalSecs - 1;

    // Calculate approximate overall progress
    const baseProgress =
      totalSecs > 0 ? (activeSectionIndex / totalSecs) * 100 : 0;
    const withinSecProgress =
      totalSecs > 0 ? (sectionProgress / totalSecs) * 100 : 0;
    progressPercent = Math.min(
      Math.round(baseProgress + withinSecProgress),
      100,
    );

    progressLabel = `Section ${activeSectionIndex + 1} of ${totalSecs} (${progressPercent}%)`;
  } else if (documentKind === "pdf" && pdfBytes) {
    canGoPrevious = currentPage > 1;
    canGoNext = currentPage < totalPages;
    progressPercent =
      totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
    progressLabel = `Page ${currentPage} of ${totalPages} (${progressPercent}%)`;
  }

  const themeClass = `theme-${settings.theme}`;

  return (
    <div className={`reader-shell ${themeClass}`}>
      <Header
        title={documentTitle}
        hasDocument={documentKind !== null}
        hasToc={
          documentKind === "epub" &&
          (epubPublication?.navigation?.length ?? 0) > 0
        }
        tocOpen={tocOpen}
        theme={settings.theme}
        onOpenFile={handleOpenFile}
        onToggleToc={() => setTocOpen(!tocOpen)}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseDocument={handleCloseDocument}
      />

      {errorMessage && (
        <ErrorBanner
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
          onOpenFile={handleOpenFile}
        />
      )}

      <main className="reader-content-area">
        {isLoading ? (
          <div className="loading-overlay">
            <div className="spinner" />
            <span>{loadingMessage}</span>
          </div>
        ) : documentKind === "epub" && epubPublication ? (
          <EpubViewer
            publication={epubPublication}
            activeSectionIndex={activeSectionIndex}
            settings={settings}
            initialProgress={initialProgress}
            onSectionChange={handleEpubSectionChange}
            onProgressChange={handleEpubProgressChange}
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
        {documentKind === "epub" && epubPublication && (
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

      {documentKind !== null && (
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
