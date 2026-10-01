import React, { useEffect, useRef, useMemo, useCallback } from "react";
import type { NormalizedPublication } from "@reflowpress/core";
import type { ReaderSettings } from "@reflowpress/reader";
import { PublicationResourceManager } from "./resource-manager.js";
import { sanitizeXhtml } from "./sanitizer.js";

export interface EpubViewerProps {
  publication: NormalizedPublication;
  activeSectionIndex: number;
  settings: ReaderSettings;
  initialProgress?: number;
  onSectionChange: (newIndex: number) => void;
  onProgressChange: (sectionIndex: number, progress: number) => void;
}

export const EpubViewer: React.FC<EpubViewerProps> = ({
  publication,
  activeSectionIndex,
  settings,
  initialProgress = 0,
  onSectionChange,
  onProgressChange,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resourceManagerRef = useRef<PublicationResourceManager | null>(null);
  const hasRestoredInitialScroll = useRef(false);

  // Initialize or re-create resource manager when publication changes
  const resourceManager = useMemo(() => {
    if (resourceManagerRef.current) {
      resourceManagerRef.current.dispose();
    }
    const rm = new PublicationResourceManager(publication.resources);
    resourceManagerRef.current = rm;
    return rm;
  }, [publication]);

  useEffect(() => {
    return () => {
      resourceManagerRef.current?.dispose();
    };
  }, []);

  const totalSections = publication.readingOrder.length;
  const currentSection = publication.readingOrder[activeSectionIndex];

  // Sanitize section content and inject theme
  const sanitizedHtml = useMemo(() => {
    if (!currentSection) return "<p>No content in this section.</p>";
    return sanitizeXhtml(
      currentSection.markup,
      currentSection.href,
      resourceManager,
      settings,
    );
  }, [currentSection, resourceManager, settings]);

  const goToNextSection = useCallback(() => {
    if (activeSectionIndex < totalSections - 1) {
      onSectionChange(activeSectionIndex + 1);
    }
  }, [activeSectionIndex, totalSections, onSectionChange]);

  const goToPreviousSection = useCallback(() => {
    if (activeSectionIndex > 0) {
      onSectionChange(activeSectionIndex - 1);
    }
  }, [activeSectionIndex, onSectionChange]);

  const handlePageStep = useCallback(
    (direction: 1 | -1) => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow || !iframe.contentDocument) return;

      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      const scrollY = win.scrollY;
      const maxScroll = Math.max(
        0,
        doc.documentElement.scrollHeight - win.innerHeight,
      );
      const step = Math.max(100, Math.floor(win.innerHeight * 0.85));

      if (direction === 1) {
        if (scrollY >= maxScroll - 5) {
          // At bottom, advance to next section
          goToNextSection();
        } else {
          win.scrollBy({ top: step, behavior: "smooth" });
        }
      } else {
        if (scrollY <= 5) {
          // At top, advance to previous section
          goToPreviousSection();
        } else {
          win.scrollBy({ top: -step, behavior: "smooth" });
        }
      }
    },
    [goToNextSection, goToPreviousSection],
  );

  // Setup scroll listener and keyboard listeners inside iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleIframeLoad = () => {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) return;

      // Restore scroll position on initial load of this section if requested
      if (!hasRestoredInitialScroll.current && initialProgress > 0) {
        const maxScroll = Math.max(
          0,
          doc.documentElement.scrollHeight - win.innerHeight,
        );
        if (maxScroll > 0) {
          win.scrollTo({
            top: Math.floor(maxScroll * initialProgress),
            behavior: "instant",
          });
        }
        hasRestoredInitialScroll.current = true;
      }

      const reportScroll = () => {
        const currentScroll = win.scrollY;
        const maxScroll = Math.max(
          1,
          doc.documentElement.scrollHeight - win.innerHeight,
        );
        const progress = Math.min(Math.max(currentScroll / maxScroll, 0), 1);
        onProgressChange(activeSectionIndex, progress);
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) {
          e.preventDefault();
          handlePageStep(1);
        } else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) {
          e.preventDefault();
          handlePageStep(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          handlePageStep(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          handlePageStep(-1);
        }
      };

      win.addEventListener("scroll", reportScroll, { passive: true });
      win.addEventListener("keydown", handleKeyDown);
    };

    iframe.addEventListener("load", handleIframeLoad);
    return () => {
      iframe.removeEventListener("load", handleIframeLoad);
    };
  }, [activeSectionIndex, initialProgress, handlePageStep, onProgressChange]);

  return (
    <div
      className="epub-viewer-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <iframe
        ref={iframeRef}
        title="EPUB Content"
        srcDoc={sanitizedHtml}
        sandbox="allow-same-origin"
        className="epub-viewport-frame"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          backgroundColor:
            settings.theme === "dark"
              ? "#181818"
              : settings.theme === "sepia"
                ? "#fbf0d9"
                : "#ffffff",
        }}
      />
    </div>
  );
};
