import type { RuleDefinition } from "./models.js";

export const RULE_REGISTRY: ReadonlyMap<string, RuleDefinition> = new Map<
  string,
  RuleDefinition
>([
  [
    "EPUB-CONTAINER-001",
    {
      id: "EPUB-CONTAINER-001",
      title: "Missing mimetype file",
      category: "container",
      defaultSeverity: "fatal",
      defaultRepairability: "safe-auto",
      description:
        "The EPUB archive is missing the required root 'mimetype' file.",
    },
  ],
  [
    "EPUB-CONTAINER-002",
    {
      id: "EPUB-CONTAINER-002",
      title: "Invalid mimetype content",
      category: "container",
      defaultSeverity: "error",
      defaultRepairability: "safe-auto",
      description:
        "The mimetype file content must be exactly 'application/epub+zip' with no trailing whitespace or extra bytes.",
    },
  ],
  [
    "EPUB-CONTAINER-003",
    {
      id: "EPUB-CONTAINER-003",
      title: "Mimetype not first entry or is compressed",
      category: "container",
      defaultSeverity: "warning",
      defaultRepairability: "safe-auto",
      description:
        "The mimetype file must be the first entry in the ZIP archive and must not be compressed (compression method 0 / STORE).",
    },
  ],
  [
    "EPUB-CONTAINER-004",
    {
      id: "EPUB-CONTAINER-004",
      title: "Missing META-INF/container.xml",
      category: "container",
      defaultSeverity: "fatal",
      defaultRepairability: "safe-auto",
      description:
        "The EPUB archive is missing the mandatory 'META-INF/container.xml' descriptor file.",
    },
  ],
  [
    "EPUB-CONTAINER-005",
    {
      id: "EPUB-CONTAINER-005",
      title: "Invalid container.xml syntax or missing rootfile",
      category: "container",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "The META-INF/container.xml file is malformed or lacks a valid <rootfile> element pointing to the OPF package document.",
    },
  ],
  [
    "EPUB-PACKAGE-001",
    {
      id: "EPUB-PACKAGE-001",
      title: "Package OPF document not found",
      category: "package",
      defaultSeverity: "fatal",
      defaultRepairability: "manual",
      description:
        "The OPF package document referenced by container.xml does not exist in the archive.",
    },
  ],
  [
    "EPUB-PACKAGE-002",
    {
      id: "EPUB-PACKAGE-002",
      title: "Invalid OPF XML syntax",
      category: "package",
      defaultSeverity: "fatal",
      defaultRepairability: "manual",
      description:
        "The OPF package document contains XML parsing or syntax errors.",
    },
  ],
  [
    "EPUB-PACKAGE-003",
    {
      id: "EPUB-PACKAGE-003",
      title: "Missing package element or version attribute",
      category: "package",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "The root element must be <package> with a valid EPUB version attribute (e.g. '2.0' or '3.0').",
    },
  ],
  [
    "EPUB-MANIFEST-001",
    {
      id: "EPUB-MANIFEST-001",
      title: "Missing manifest element in OPF",
      category: "manifest",
      defaultSeverity: "fatal",
      defaultRepairability: "manual",
      description:
        "The OPF package document lacks a required <manifest> element.",
    },
  ],
  [
    "EPUB-MANIFEST-002",
    {
      id: "EPUB-MANIFEST-002",
      title: "Manifest item missing id or href attribute",
      category: "manifest",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "Each <item> in the manifest must specify non-empty 'id' and 'href' attributes.",
    },
  ],
  [
    "EPUB-MANIFEST-003",
    {
      id: "EPUB-MANIFEST-003",
      title: "Referenced manifest item missing in archive",
      category: "manifest",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "A file declared in the OPF manifest could not be found inside the ZIP archive.",
    },
  ],
  [
    "EPUB-MANIFEST-004",
    {
      id: "EPUB-MANIFEST-004",
      title: "Manifest item media-type is invalid or mismatched",
      category: "manifest",
      defaultSeverity: "warning",
      defaultRepairability: "safe-auto",
      description:
        "A manifest item declares an incorrect media-type that contradicts its known file extension and standard MIME type.",
    },
  ],
  [
    "EPUB-SPINE-001",
    {
      id: "EPUB-SPINE-001",
      title: "Missing spine element in OPF",
      category: "reading-order",
      defaultSeverity: "fatal",
      defaultRepairability: "manual",
      description:
        "The OPF package document lacks a required <spine> element defining the reading order.",
    },
  ],
  [
    "EPUB-SPINE-002",
    {
      id: "EPUB-SPINE-002",
      title: "Spine is empty",
      category: "reading-order",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "The <spine> element does not contain any <itemref> elements.",
    },
  ],
  [
    "EPUB-SPINE-003",
    {
      id: "EPUB-SPINE-003",
      title: "Spine itemref references non-existent manifest item",
      category: "reading-order",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "An <itemref> idref attribute does not match any <item id> in the OPF manifest.",
    },
  ],
  [
    "EPUB-NAV-001",
    {
      id: "EPUB-NAV-001",
      title: "Navigation document missing",
      category: "navigation",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "The publication lacks an EPUB 3 navigation document (properties='nav') or EPUB 2 NCX file.",
    },
  ],
  [
    "EPUB-NAV-002",
    {
      id: "EPUB-NAV-002",
      title: "Navigation link target not found in manifest or archive",
      category: "navigation",
      defaultSeverity: "warning",
      defaultRepairability: "manual",
      description:
        "A navigation link points to an internal resource or fragment that cannot be found.",
    },
  ],
  [
    "EPUB-NAV-003",
    {
      id: "EPUB-NAV-003",
      title: "Navigation document has invalid XML syntax",
      category: "navigation",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description: "The navigation document could not be parsed as valid XML.",
    },
  ],
  [
    "EPUB-RESOURCE-001",
    {
      id: "EPUB-RESOURCE-001",
      title: "Unmanifested orphan resource in archive",
      category: "resource",
      defaultSeverity: "info",
      defaultRepairability: "review-required",
      description:
        "A file exists in the ZIP archive that is not declared in the OPF manifest and not referenced by any document.",
    },
  ],
  [
    "EPUB-RESOURCE-002",
    {
      id: "EPUB-RESOURCE-002",
      title: "Broken internal hyperlink or resource reference",
      category: "resource",
      defaultSeverity: "warning",
      defaultRepairability: "manual",
      description:
        "An internal link, image src, or stylesheet reference inside a chapter points to a non-existent file.",
    },
  ],
  [
    "EPUB-META-001",
    {
      id: "EPUB-META-001",
      title: "Missing required dc:title metadata",
      category: "metadata",
      defaultSeverity: "error",
      defaultRepairability: "manual",
      description:
        "The OPF package metadata does not contain a <dc:title> element.",
    },
  ],
  [
    "EPUB-META-002",
    {
      id: "EPUB-META-002",
      title: "Missing required dc:language metadata",
      category: "metadata",
      defaultSeverity: "warning",
      defaultRepairability: "manual",
      description:
        "The OPF package metadata does not contain a <dc:language> element.",
    },
  ],
  [
    "EPUB-META-003",
    {
      id: "EPUB-META-003",
      title: "Missing required dc:identifier metadata",
      category: "metadata",
      defaultSeverity: "warning",
      defaultRepairability: "manual",
      description:
        "The OPF package metadata does not contain a <dc:identifier> element.",
    },
  ],
  [
    "EPUB-SEC-001",
    {
      id: "EPUB-SEC-001",
      title: "Unsafe path traversal or absolute path in archive entry",
      category: "security",
      defaultSeverity: "fatal",
      defaultRepairability: "manual",
      description:
        "An entry in the ZIP archive has a path containing '..' segments, backslashes, or absolute root references.",
    },
  ],
  [
    "EPUB-SEC-002",
    {
      id: "EPUB-SEC-002",
      title: "Unsafe script tag or javascript scheme detected",
      category: "security",
      defaultSeverity: "warning",
      defaultRepairability: "manual",
      description:
        "A content document contains executable script tags or 'javascript:' URI schemes.",
    },
  ],
  [
    "PDF-STRUCT-001",
    {
      id: "PDF-STRUCT-001",
      title: "Invalid or unparseable PDF document",
      category: "pdf-structure",
      defaultSeverity: "fatal",
      defaultRepairability: "none",
      description:
        "The file cannot be opened as a valid PDF document or header signature is missing.",
    },
  ],
  [
    "PDF-STRUCT-002",
    {
      id: "PDF-STRUCT-002",
      title: "PDF document contains 0 pages",
      category: "pdf-structure",
      defaultSeverity: "error",
      defaultRepairability: "none",
      description: "The PDF document contains zero renderable pages.",
    },
  ],
  [
    "PDF-ENCRYPT-001",
    {
      id: "PDF-ENCRYPT-001",
      title: "PDF is encrypted or password-protected",
      category: "pdf-structure",
      defaultSeverity: "error",
      defaultRepairability: "none",
      description:
        "The PDF document is password-protected or encrypted, preventing automated inspection.",
    },
  ],
  [
    "PDF-TEXT-001",
    {
      id: "PDF-TEXT-001",
      title: "Page has no extractable text layer (scanned/raster only)",
      category: "pdf-text",
      defaultSeverity: "warning",
      defaultRepairability: "none",
      description:
        "A PDF page contains zero extractable text items, suggesting a scanned or purely graphical page.",
    },
  ],
  [
    "PDF-TEXT-002",
    {
      id: "PDF-TEXT-002",
      title: "Document has very low text content",
      category: "pdf-text",
      defaultSeverity: "info",
      defaultRepairability: "none",
      description:
        "The document-wide extractable text character count is unusually low.",
    },
  ],
  [
    "PDF-GEOM-001",
    {
      id: "PDF-GEOM-001",
      title: "Page has invalid or non-positive dimensions",
      category: "pdf-geometry",
      defaultSeverity: "error",
      defaultRepairability: "none",
      description:
        "A PDF page viewport has zero or negative width or height dimensions.",
    },
  ],
  [
    "PDF-GEOM-002",
    {
      id: "PDF-GEOM-002",
      title: "Page has irregular or extreme dimensions",
      category: "pdf-geometry",
      defaultSeverity: "info",
      defaultRepairability: "none",
      description:
        "A PDF page aspect ratio or size deviates significantly from standard document dimensions.",
    },
  ],
  [
    "PDF-IMAGE-001",
    {
      id: "PDF-IMAGE-001",
      title: "Raster image rendered without text layer",
      category: "pdf-image",
      defaultSeverity: "info",
      defaultRepairability: "none",
      description:
        "Page renders raster image objects without an associated OCR text layer.",
    },
  ],
  [
    "PDF-FONT-001",
    {
      id: "PDF-FONT-001",
      title: "Font embedding boundary inspection",
      category: "pdf-font",
      defaultSeverity: "info",
      defaultRepairability: "none",
      description:
        "PDF.js public API limits font embedding certification. Standard embedded font metrics are informational only.",
    },
  ],
]);

export function getRuleDefinition(ruleId: string): RuleDefinition | undefined {
  return RULE_REGISTRY.get(ruleId);
}
