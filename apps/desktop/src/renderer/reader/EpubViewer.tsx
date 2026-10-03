import React, { useEffect, useRef, useMemo, useCallback } from "react";
import type { NormalizedPublication } from "@reflowpress/core";
import type { ReaderSettings } from "@reflowpress/reader";
import {
  calculateProgressionDelta,
  resolveReadingFlow,
  resolveWritingMode,
} from "@reflowpress/typography";
import { PublicationResourceManager } from "./resource-manager.js";
import { sanitizeXhtml } from "./sanitizer.js";

import type { HighlightAnnotation } from "@reflowpress/annotations";

export interface EpubViewerProps {
  publication: NormalizedPublication;
  activeSectionIndex: number;
  settings: ReaderSettings;
  initialProgress?: number;
  highlights?: HighlightAnnotation[];
  searchTarget?: {
    textQuote: { exact: string; prefix?: string; suffix?: string };
  } | null;
  onSectionChange: (newIndex: number) => void;
  onProgressChange: (sectionIndex: number, progress: number) => void;
  onSelectionChange?: (
    selection: { text: string; prefix?: string; suffix?: string } | null,
  ) => void;
}

export const EpubViewer: React.FC<EpubViewerProps> = ({
  publication,
  activeSectionIndex,
  settings,
  initialProgress = 0,
  highlights = [],
  searchTarget = null,
  onSectionChange,
  onProgressChange,
  onSelectionChange,
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

  const writingModeSetting = settings.writingMode ?? "auto";
  const resolvedWritingMode = useMemo(() => {
    return resolveWritingMode(writingModeSetting, {
      pageProgressionDirection:
        publication.metadata.direction === "rtl" ? "rtl" : undefined,
      renditionDirection:
        publication.metadata.direction === "rtl" ? "rtl" : undefined,
      markupSnippet: currentSection?.markup.slice(0, 3000),
    });
  }, [writingModeSetting, publication.metadata, currentSection?.markup]);

  const flow = useMemo(() => {
    return resolveReadingFlow(resolvedWritingMode);
  }, [resolvedWritingMode]);

  // Sanitize section content and inject theme
  const sanitizedHtml = useMemo(() => {
    if (!currentSection) return "<p>No content in this section.</p>";
    return sanitizeXhtml(
      currentSection.markup,
      currentSection.href,
      resourceManager,
      settings,
      {
        pageProgressionDirection:
          publication.metadata.direction === "rtl" ? "rtl" : undefined,
        renditionDirection:
          publication.metadata.direction === "rtl" ? "rtl" : undefined,
        markupSnippet: currentSection.markup.slice(0, 3000),
      },
    );
  }, [currentSection, resourceManager, settings, publication.metadata]);

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

      if (flow.writingMode === "vertical-rl") {
        const delta = calculateProgressionDelta(
          flow,
          direction === 1 ? "next" : "previous",
          { width: win.innerWidth, height: win.innerHeight },
        );

        const currentLeft = win.scrollX;
        // In vertical-rl, check if already at edge
        const maxScrollLeft = doc.documentElement.scrollWidth - win.innerWidth;

        if (
          direction === 1 &&
          (Math.abs(currentLeft) >= maxScrollLeft - 10 ||
            currentLeft <= -maxScrollLeft + 10)
        ) {
          goToNextSection();
        } else if (direction === -1 && Math.abs(currentLeft) <= 10) {
          goToPreviousSection();
        } else {
          win.scrollBy({ left: delta.deltaX, top: 0, behavior: "smooth" });
        }
        return;
      }

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
    [flow, goToNextSection, goToPreviousSection],
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

      const handleSelection = () => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed) {
          onSelectionChange?.(null);
          return;
        }
        const text = selection.toString().trim();
        if (!text) {
          onSelectionChange?.(null);
          return;
        }
        onSelectionChange?.({ text });
      };

      win.addEventListener("scroll", reportScroll, { passive: true });
      win.addEventListener("keydown", handleKeyDown);
      doc.addEventListener("selectionchange", handleSelection);
      doc.addEventListener("mouseup", handleSelection);
    };

    iframe.addEventListener("load", handleIframeLoad);
    return () => {
      iframe.removeEventListener("load", handleIframeLoad);
    };
  }, [
    activeSectionIndex,
    initialProgress,
    handlePageStep,
    onProgressChange,
    onSelectionChange,
  ]);

  // Decorate persistent highlights in rendered DOM
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument || !currentSection) return;
    const doc = iframe.contentDocument;

    // Remove existing highlights
    const oldMarks = doc.querySelectorAll("mark.reflowpress-highlight");
    oldMarks.forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    });

    const sectionHighlights = highlights.filter(
      (h) =>
        h.locator.kind === "epub" &&
        h.locator.sectionHref === currentSection.href,
    );

    const colorStyles: Record<string, string> = {
      yellow:
        "background-color: #fef08a; color: inherit; padding: 1px 2px; border-radius: 2px;",
      green:
        "background-color: #bbf7d0; color: inherit; padding: 1px 2px; border-radius: 2px;",
      blue: "background-color: #bfdbfe; color: inherit; padding: 1px 2px; border-radius: 2px;",
      pink: "background-color: #fbcfe8; color: inherit; padding: 1px 2px; border-radius: 2px;",
    };

    for (const h of sectionHighlights) {
      const exact = h.textQuote.exact;
      if (!exact) continue;

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let currentNode: Node | null = walker.nextNode();
      while (currentNode) {
        const nodeText = currentNode.nodeValue || "";
        const idx = nodeText.indexOf(exact);
        if (idx !== -1 && currentNode.parentNode) {
          try {
            const range = doc.createRange();
            range.setStart(currentNode, idx);
            range.setEnd(currentNode, idx + exact.length);
            const mark = doc.createElement("mark");
            mark.className = `reflowpress-highlight reflowpress-highlight-${h.color}`;
            mark.setAttribute("data-annotation-id", h.id);
            mark.style.cssText = colorStyles[h.color] || colorStyles.yellow!;
            range.surroundContents(mark);
          } catch {
            // Ignore boundary cross errors
          }
          break;
        }
        currentNode = walker.nextNode();
      }
    }
  }, [highlights, currentSection, sanitizedHtml]);

  // Handle search target highlight and scroll
  useEffect(() => {
    if (!searchTarget) return;
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const doc = iframe.contentDocument;

    const oldSearch = doc.querySelectorAll("mark.reflowpress-search-match");
    oldSearch.forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    });

    const exact = searchTarget.textQuote.exact;
    if (!exact) return;

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let currentNode: Node | null = walker.nextNode();
    while (currentNode) {
      const nodeText = currentNode.nodeValue || "";
      const idx = nodeText.toLowerCase().indexOf(exact.toLowerCase());
      if (idx !== -1 && currentNode.parentNode) {
        try {
          const range = doc.createRange();
          range.setStart(currentNode, idx);
          range.setEnd(currentNode, idx + exact.length);
          const mark = doc.createElement("mark");
          mark.className = "reflowpress-search-match";
          mark.style.cssText =
            "background-color: #fde047; color: #000; padding: 2px 4px; border-radius: 3px; outline: 2px solid #ca8a04;";
          range.surroundContents(mark);
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          // Ignore range error
        }
        break;
      }
      currentNode = walker.nextNode();
    }
  }, [searchTarget, currentSection]);

  return (
    <div
      className="epub-viewer-container"
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <iframe
        ref={iframeRef}
        title={`Book content — ${currentSection?.id || publication.metadata.title}`}
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
