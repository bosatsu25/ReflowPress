import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { ReaderSettings } from "@reflowpress/reader";
import { clampPdfPage, clampPdfZoom, PDF_ZOOM_STEP } from "@reflowpress/reader";

// Set workerSrc using ES URL resolution
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // Fallback if URL resolution fails
  }
}

import type { HighlightAnnotation } from "@reflowpress/annotations";

export interface PdfViewerProps {
  pdfBytes: Uint8Array;
  currentPage: number;
  zoom: number;
  settings: ReaderSettings;
  highlights?: HighlightAnnotation[];
  onPageChange: (newPage: number, totalPages: number) => void;
  onZoomChange: (newZoom: number) => void;
  onPagesExtracted?: (pages: Array<{ page: number; text: string }>) => void;
  onSelectionChange?: (
    selection: { text: string; page: number } | null,
  ) => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfBytes,
  currentPage,
  zoom,
  settings,
  highlights = [],
  onPageChange,
  onZoomChange,
  onPagesExtracted,
  onSelectionChange,
}) => {
  void highlights;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderTaskRef = useRef<{ cancel(): void } | null>(null);

  // Load PDF Document
  useEffect(() => {
    let isCancelled = false;
    setRenderError(null);

    const loadTask = pdfjsLib.getDocument({
      data: pdfBytes,
    });

    loadTask.promise
      .then((doc) => {
        if (!isCancelled) {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          onPageChange(clampPdfPage(currentPage, doc.numPages), doc.numPages);
        }
      })
      .catch((err: Error) => {
        if (!isCancelled) {
          setRenderError(err.message || "Failed to parse PDF document.");
        }
      });

    return () => {
      isCancelled = true;
      loadTask.destroy().catch(() => {});
    };
  }, [pdfBytes]);

  // Extract text across all pages for in-book search and tools
  useEffect(() => {
    if (!pdfDoc || !onPagesExtracted) return;
    let isCancelled = false;

    const extractPages = async () => {
      const extracted: Array<{ page: number; text: string }> = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (isCancelled) break;
        try {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          extracted.push({ page: i, text: pageText });
        } catch {
          // Continue best effort
        }
      }
      if (!isCancelled) {
        onPagesExtracted(extracted);
      }
    };

    extractPages();
    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, onPagesExtracted]);

  // Handle text selection in PDF container
  useEffect(() => {
    if (!onSelectionChange) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        onSelectionChange(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        onSelectionChange(null);
        return;
      }
      onSelectionChange({ text, page: currentPage });
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("mouseup", handleMouseUp);
      return () => {
        container.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [currentPage, onSelectionChange]);

  // Render current page onto canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    let isCancelled = false;
    const pageNum = clampPdfPage(currentPage, totalPages);

    pdfDoc
      .getPage(pageNum)
      .then((page) => {
        if (isCancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        const viewport = page.getViewport({ scale: zoom });

        // Adjust for device pixel ratio for sharp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
          canvasContext: context,
          viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;

        return task.promise;
      })
      .catch((err: unknown) => {
        if (
          (err as { name?: string })?.name !== "RenderingCancelledException"
        ) {
          console.error("PDF page render error:", err);
        }
      });

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, currentPage, zoom, totalPages]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1, totalPages);
    }
  }, [currentPage, totalPages, onPageChange]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1, totalPages);
    }
  }, [currentPage, totalPages, onPageChange]);

  const handleZoomIn = () => {
    onZoomChange(clampPdfZoom(zoom + PDF_ZOOM_STEP));
  };

  const handleZoomOut = () => {
    onZoomChange(clampPdfZoom(zoom - PDF_ZOOM_STEP));
  };

  const handleResetZoom = () => {
    onZoomChange(1.0);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if an input is focused
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }

      if (
        e.key === "PageDown" ||
        (e.key === " " && !e.shiftKey) ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        handleNextPage();
      } else if (
        e.key === "PageUp" ||
        (e.key === " " && e.shiftKey) ||
        e.key === "ArrowLeft"
      ) {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === "Home") {
        e.preventDefault();
        onPageChange(1, totalPages);
      } else if (e.key === "End") {
        e.preventDefault();
        onPageChange(totalPages, totalPages);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleNextPage, handlePrevPage, totalPages, onPageChange]);

  const containerBg =
    settings.theme === "dark"
      ? "#121212"
      : settings.theme === "sepia"
        ? "#e8ded1"
        : "#e5e7eb";

  return (
    <div
      ref={containerRef}
      className="pdf-viewer-container"
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: containerBg,
        padding: "24px 0",
        boxTrans: "border-box",
        position: "relative",
      }}
    >
      {/* PDF Floating Toolbar for Zoom */}
      <div
        className="pdf-floating-controls"
        style={{
          position: "sticky",
          top: "12px",
          zIndex: 10,
          display: "flex",
          gap: "8px",
          alignItems: "center",
          backgroundColor: settings.theme === "dark" ? "#2d3748" : "#ffffff",
          color: settings.theme === "dark" ? "#f7fafc" : "#1a202c",
          padding: "6px 12px",
          borderRadius: "6px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          marginBottom: "16px",
        }}
      >
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={zoom <= 0.5}
          title="Zoom Out"
          style={{
            padding: "4px 8px",
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        >
          -
        </button>
        <span
          style={{
            fontSize: "13px",
            minWidth: "48px",
            textAlign: "center",
            userSelect: "none",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={zoom >= 3.0}
          title="Zoom In"
          style={{
            padding: "4px 8px",
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        >
          +
        </button>
        <button
          type="button"
          onClick={handleResetZoom}
          title="Reset Zoom (100%)"
          style={{
            padding: "4px 8px",
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontSize: "12px",
          }}
        >
          100%
        </button>
      </div>

      {renderError ? (
        <div
          style={{
            padding: "24px",
            color: "#e53e3e",
            background: "#fff5f5",
            borderRadius: "6px",
          }}
        >
          <p>
            <strong>Error displaying PDF:</strong> {renderError}
          </p>
        </div>
      ) : (
        <div
          className="pdf-canvas-wrapper"
          style={{
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
            backgroundColor: "#ffffff",
            display: "inline-block",
            lineHeight: 0,
          }}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />
        </div>
      )}
    </div>
  );
};
