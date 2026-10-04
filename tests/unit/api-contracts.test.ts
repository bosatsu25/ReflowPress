import { describe, it, expect } from "vitest";

import * as Core from "../../packages/core/src/index.js";
import * as Epub from "../../packages/epub/src/index.js";
import * as Pdf from "../../packages/pdf/src/index.js";
import * as Renderer from "../../packages/renderer/src/index.js";
import * as Typography from "../../packages/typography/src/index.js";
import * as Reader from "../../packages/reader/src/index.js";
import * as Search from "../../packages/search/src/index.js";
import * as Annotations from "../../packages/annotations/src/index.js";
import * as Library from "../../packages/library/src/index.js";
import * as Export from "../../packages/export/src/index.js";
import * as Quality from "../../packages/quality/src/index.js";
import * as Repair from "../../packages/repair/src/index.js";
import * as Validation from "../../packages/validation/src/index.js";
import * as Opds from "../../packages/opds/src/index.js";
import * as Sync from "../../packages/sync/src/index.js";
import * as Device from "../../packages/device/src/index.js";

describe("Public API Contracts Freeze (@reflowpress/*)", () => {
  it("@reflowpress/core exports canonical version", () => {
    expect(Core.REFLOWPRESS_VERSION).toBeDefined();
    expect(typeof Core.REFLOWPRESS_VERSION).toBe("string");
  });

  it("@reflowpress/epub exports inspection, loading, navigation, and media-overlay parsers", () => {
    expect(typeof Epub.inspectEpub).toBe("function");
    expect(typeof Epub.loadEpub).toBe("function");
    expect(typeof Epub.parseNavDocument).toBe("function");
    expect(typeof Epub.parseNcxDocument).toBe("function");
    expect(typeof Epub.parseSmilDocument).toBe("function");
    expect(typeof Epub.parseClockValue).toBe("function");
    expect(Epub.EpubLoader).toBeDefined();
    expect(Epub.DEFAULT_LOADER_LIMITS).toBeDefined();
  });

  it("@reflowpress/pdf exports inspectPdfBytes", () => {
    expect(typeof Pdf.inspectPdfBytes).toBe("function");
  });

  it("@reflowpress/renderer exports ChromiumPdfRenderer", () => {
    expect(Renderer.ChromiumPdfRenderer).toBeDefined();
  });

  it("@reflowpress/typography exports CSS generator and TCY transform", () => {
    expect(typeof Typography.generateTypographyCss).toBe("function");
    expect(typeof Typography.normalizeLegacyEpubCss).toBe("function");
    expect(typeof Typography.applyTcyAssist).toBe("function");
    expect(typeof Typography.removeTcySpans).toBe("function");
    expect(typeof Typography.resolveWritingMode).toBe("function");
    expect(Typography.DEFAULT_JAPANESE_TYPOGRAPHY_SETTINGS).toBeDefined();
  });

  it("@reflowpress/reader exports settings clamps and navigation helpers", () => {
    expect(typeof Reader.clampFontSize).toBe("function");
    expect(typeof Reader.clampLineHeight).toBe("function");
    expect(typeof Reader.clampMargin).toBe("function");
    expect(typeof Reader.clampProgress).toBe("function");
    expect(typeof Reader.getNextSectionIndex).toBe("function");
    expect(typeof Reader.getPreviousSectionIndex).toBe("function");
    expect(typeof Reader.findSectionIndexByHref).toBe("function");
    expect(typeof Reader.clampPdfPage).toBe("function");
    expect(typeof Reader.clampPdfZoom).toBe("function");
    expect(Reader.DEFAULT_READER_SETTINGS).toBeDefined();
  });

  it("@reflowpress/search exports epub and pdf full-text search", () => {
    expect(typeof Search.searchEpubSections).toBe("function");
    expect(typeof Search.searchPdfPages).toBe("function");
    expect(typeof Search.extractVisibleText).toBe("function");
    expect(typeof Search.createSearchSnippet).toBe("function");
  });

  it("@reflowpress/annotations exports bookmarks, highlights, notes, and export/import", () => {
    expect(typeof Annotations.createBookmark).toBe("function");
    expect(typeof Annotations.createHighlight).toBe("function");
    expect(typeof Annotations.createNote).toBe("function");
    expect(typeof Annotations.filterAnnotations).toBe("function");
    expect(typeof Annotations.searchAnnotations).toBe("function");
    expect(typeof Annotations.exportAnnotationsToJson).toBe("function");
    expect(typeof Annotations.importAnnotationsFromJson).toBe("function");
    expect(typeof Annotations.exportAnnotationsToMarkdown).toBe("function");
    expect(typeof Annotations.matchTextQuote).toBe("function");
  });

  it("@reflowpress/library exports catalog operations and collections", () => {
    expect(typeof Library.createDefaultCatalog).toBe("function");
    expect(typeof Library.addBookToCatalog).toBe("function");
    expect(typeof Library.removeBookFromCatalog).toBe("function");
    expect(typeof Library.updateBookInCatalog).toBe("function");
    expect(typeof Library.filterBooks).toBe("function");
    expect(typeof Library.sortBooks).toBe("function");
    expect(typeof Library.createCollection).toBe("function");
    expect(typeof Library.deleteCollection).toBe("function");
    expect(typeof Library.addBookToCollection).toBe("function");
    expect(typeof Library.removeBookFromCollection).toBe("function");
  });

  it("@reflowpress/export exports orchestrator, batch, deterministic filename, and exporters", () => {
    expect(typeof Export.exportPublication).toBe("function");
    expect(typeof Export.exportBatch).toBe("function");
    expect(typeof Export.generateDeterministicFilename).toBe("function");
    expect(typeof Export.sanitizeStem).toBe("function");
    expect(typeof Export.formatTimestamp).toBe("function");
    expect(typeof Export.exportToHtml).toBe("function");
    expect(typeof Export.exportToMarkdown).toBe("function");
    expect(typeof Export.exportToPdf).toBe("function");
  });

  it("@reflowpress/quality exports diagnostic engines, quality gates, and rule registry", () => {
    expect(typeof Quality.inspectEpubHealth).toBe("function");
    expect(typeof Quality.inspectPdfHealth).toBe("function");
    expect(typeof Quality.evaluateQualityGate).toBe("function");
    expect(typeof Quality.sortFindings).toBe("function");
    expect(typeof Quality.deduplicateFindings).toBe("function");
    expect(Quality.RULE_REGISTRY).toBeDefined();
    expect(typeof Quality.getRuleDefinition).toBe("function");
  });

  it("@reflowpress/repair exports repair planner, orchestrator, and canonical zip builder", () => {
    expect(typeof Repair.planRepairs).toBe("function");
    expect(typeof Repair.executeRepair).toBe("function");
    expect(typeof Repair.buildCanonicalEpubZip).toBe("function");
  });

  it("@reflowpress/validation exports BaselinePdfValidator", () => {
    expect(Validation.BaselinePdfValidator).toBeDefined();
  });

  it("@reflowpress/opds exports feed generator, parser, server, and client", () => {
    expect(typeof Opds.generateOpds2Catalog).toBe("function");
    expect(typeof Opds.mapBookToPublication).toBe("function");
    expect(typeof Opds.parseOpdsFeed).toBe("function");
    expect(typeof Opds.fetchRemoteOpdsFeed).toBe("function");
    expect(typeof Opds.validateSafeUrl).toBe("function");
    expect(Opds.OpdsServer).toBeDefined();
    expect(Opds.OPDS2_MIME_TYPE).toBeDefined();
    expect(Opds.OPDS2_CATALOG_CONTEXT).toBeDefined();
    expect(Opds.OPDS_RELS).toBeDefined();
  });

  it("@reflowpress/sync exports sync adapters, bundle serialization, and 3-way merge", () => {
    expect(Sync.DEFAULT_SYNC_LOCK_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(Sync.FolderSyncAdapter).toBeDefined();
    expect(Sync.WebdavSyncAdapter).toBeDefined();
    expect(typeof Sync.computePortablePublicationId).toBe("function");
    expect(typeof Sync.mergeSnapshots).toBe("function");
    expect(typeof Sync.serializeSyncBundle).toBe("function");
    expect(typeof Sync.deserializeSyncBundle).toBe("function");
    expect(typeof Sync.createRestorePlan).toBe("function");
    expect(typeof Sync.applyRestore).toBe("function");
  });

  it("@reflowpress/device exports device profile detector, adapters, and known profiles", () => {
    expect(typeof Device.detectDeviceProfile).toBe("function");
    expect(Device.KNOWN_PROFILES).toBeDefined();
    expect(Device.FilesystemDeviceAdapter).toBeDefined();
    expect(Device.MtpDeviceAdapter).toBeDefined();
  });
});
