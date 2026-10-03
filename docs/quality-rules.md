# ReflowPress Quality Diagnostic Rule Catalog

This document specifies the complete catalog of stable diagnostic rule IDs evaluated by the `@reflowpress/quality` diagnostic rule engine.

---

## 1. Overview & Classification Schema

Each diagnostic rule is uniquely identified by a stable, immutable string ID in the format:
`<FORMAT>-<CATEGORY>-<NUMBER>`

### 1.1 Severities

- **`fatal`**: Critical defect preventing the publication from being read, parsed, or processed. Halts further downstream operations.
- **`error`**: Conformance violation or broken reference that breaks navigation, missing resources, or corrupts specific content.
- **`warning`**: Minor standard deviation, obsolete construct, or suboptimal structure that does not prevent opening.
- **`info`**: Informational observation, optimization hint, or inspection boundary disclaimer.

### 1.2 Repairabilities

- **`safe-auto`**: Whitelisted for fully automatic, deterministic, non-destructive repair. Mathematically and syntactically unambiguous.
- **`review-required`**: Remediation requires user discretion or interactive confirmation (e.g. unreferenced orphan files).
- **`manual`**: Defect requires author or content intervention (e.g. malformed XHTML tags, missing chapters, lost images).
- **`none`**: Finding is non-repairable or informational only.

---

## 2. EPUB Diagnostic Rules

### 2.1 Container Rules (`EPUB-CONTAINER-*`)

| Rule ID              | Title                                     | Default Severity | Repairability | Description                                                                     |
| :------------------- | :---------------------------------------- | :--------------- | :------------ | :------------------------------------------------------------------------------ |
| `EPUB-CONTAINER-001` | Missing mimetype file                     | `fatal`          | `safe-auto`   | The EPUB archive lacks the mandatory root `mimetype` file.                      |
| `EPUB-CONTAINER-002` | Invalid mimetype content                  | `error`          | `safe-auto`   | The `mimetype` file does not contain exact ASCII string `application/epub+zip`. |
| `EPUB-CONTAINER-003` | Mimetype not first entry or is compressed | `warning`        | `safe-auto`   | The `mimetype` entry is compressed or not at byte offset 38 as entry 0.         |
| `EPUB-CONTAINER-004` | Missing META-INF/container.xml            | `fatal`          | `safe-auto`   | The archive is missing the mandatory `META-INF/container.xml` descriptor.       |
| `EPUB-CONTAINER-005` | Invalid container.xml syntax              | `error`          | `manual`      | `META-INF/container.xml` contains malformed XML or lacks `<rootfile>`.          |

### 2.2 Package Document Rules (`EPUB-PACKAGE-*`)

| Rule ID            | Title                              | Default Severity | Repairability | Description                                                                    |
| :----------------- | :--------------------------------- | :--------------- | :------------ | :----------------------------------------------------------------------------- |
| `EPUB-PACKAGE-001` | Package OPF document not found     | `fatal`          | `manual`      | The package document referenced in `container.xml` is missing from the ZIP.    |
| `EPUB-PACKAGE-002` | Invalid OPF XML syntax             | `fatal`          | `manual`      | The OPF package document contains XML parsing or syntax errors.                |
| `EPUB-PACKAGE-003` | Missing package element or version | `error`          | `manual`      | Root element is not `<package>` or lacks `version` attribute (`2.0` or `3.0`). |

### 2.3 Manifest Rules (`EPUB-MANIFEST-*`)

| Rule ID             | Title                                       | Default Severity | Repairability | Description                                                                                                                             |
| :------------------ | :------------------------------------------ | :--------------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `EPUB-MANIFEST-001` | Missing manifest element in OPF             | `fatal`          | `manual`      | OPF document lacks `<manifest>` element.                                                                                                |
| `EPUB-MANIFEST-002` | Manifest item missing id or href            | `error`          | `manual`      | A manifest `<item>` lacks required `id` or `href` attributes.                                                                           |
| `EPUB-MANIFEST-003` | Referenced manifest item missing in archive | `error`          | `manual`      | An item listed in the manifest does not exist in the ZIP archive.                                                                       |
| `EPUB-MANIFEST-004` | Manifest item media-type mismatch           | `warning`        | `safe-auto`*  | Item declares a MIME type conflicting with its standard file extension. Safe-auto fixable for `.xhtml`, `.css`, `.png`, `.jpg`, `.svg`. |

### 2.4 Reading Order & Spine Rules (`EPUB-SPINE-*`)

| Rule ID          | Title                                    | Default Severity | Repairability | Description                                                                  |
| :--------------- | :--------------------------------------- | :--------------- | :------------ | :--------------------------------------------------------------------------- |
| `EPUB-SPINE-001` | Missing spine element in OPF             | `fatal`          | `manual`      | OPF document lacks `<spine>` element.                                        |
| `EPUB-SPINE-002` | Spine is empty                           | `error`          | `manual`      | `<spine>` contains zero `<itemref>` elements.                                |
| `EPUB-SPINE-003` | Spine itemref references non-existent id | `error`          | `manual`      | Spine `<itemref idref="...">` does not match any manifest `<item id="...">`. |

### 2.5 Navigation Rules (`EPUB-NAV-*`)

| Rule ID        | Title                           | Default Severity | Repairability | Description                                                                         |
| :------------- | :------------------------------ | :--------------- | :------------ | :---------------------------------------------------------------------------------- |
| `EPUB-NAV-001` | Navigation document missing     | `error`          | `manual`      | Publication lacks an EPUB 3 navigation document (`properties="nav"`) or EPUB 2 NCX. |
| `EPUB-NAV-002` | Navigation link target missing  | `warning`        | `manual`      | A navigation link points to an internal resource or anchor that cannot be found.    |
| `EPUB-NAV-003` | Navigation document invalid XML | `error`          | `manual`      | Navigation document has XML parsing errors.                                         |

### 2.6 Resource Graph & Integrity Rules (`EPUB-RESOURCE-*`)

| Rule ID             | Title                        | Default Severity | Repairability     | Description                                                                                       |
| :------------------ | :--------------------------- | :--------------- | :---------------- | :------------------------------------------------------------------------------------------------ |
| `EPUB-RESOURCE-001` | Unmanifested orphan resource | `info`           | `review-required` | File exists in the archive but is not declared in the manifest and not referenced by any chapter. |
| `EPUB-RESOURCE-002` | Broken internal reference    | `warning`        | `manual`          | Broken `<img src>`, `<link href>`, or CSS `url(...)` reference.                                   |

### 2.7 Metadata Rules (`EPUB-META-*`)

| Rule ID         | Title                             | Default Severity | Repairability | Description                               |
| :-------------- | :-------------------------------- | :--------------- | :------------ | :---------------------------------------- |
| `EPUB-META-001` | Missing required dc:title         | `error`          | `manual`      | Package metadata lacks `<dc:title>`.      |
| `EPUB-META-002` | Missing recommended dc:language   | `warning`        | `manual`      | Package metadata lacks `<dc:language>`.   |
| `EPUB-META-003` | Missing recommended dc:identifier | `warning`        | `manual`      | Package metadata lacks `<dc:identifier>`. |

### 2.8 Security Rules (`EPUB-SEC-*`)

| Rule ID        | Title                             | Default Severity | Repairability | Description                                                                      |
| :------------- | :-------------------------------- | :--------------- | :------------ | :------------------------------------------------------------------------------- |
| `EPUB-SEC-001` | Unsafe path traversal in archive  | `fatal`          | `manual`      | ZIP entry path contains `..`, `\`, absolute paths, or NUL characters.            |
| `EPUB-SEC-002` | Unsafe executable script detected | `warning`        | `manual`      | Content document contains executable `<script>` tag or `javascript:` URI scheme. |

---

## 3. PDF Quality Gate Rules

| Rule ID           | Title                                    | Default Severity | Category        | Description                                                                                                                        |
| :---------------- | :--------------------------------------- | :--------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `PDF-STRUCT-001`  | Invalid or unparseable PDF document      | `fatal`          | `pdf-structure` | Missing `%PDF-` header magic signature or corrupted trailer.                                                                       |
| `PDF-STRUCT-002`  | PDF document contains 0 pages            | `error`          | `pdf-structure` | Document has zero renderable pages.                                                                                                |
| `PDF-ENCRYPT-001` | PDF is encrypted or password-protected   | `error`          | `pdf-structure` | Encrypted document cannot be inspected headlessly.                                                                                 |
| `PDF-TEXT-001`    | Page has no extractable text layer       | `warning`        | `pdf-text`      | Page contains 0 extractable text characters (scanned / image-only).                                                                |
| `PDF-TEXT-002`    | Document has very low text content       | `info`           | `pdf-text`      | Total document text count is unusually low (< 20 characters).                                                                      |
| `PDF-GEOM-001`    | Page has invalid dimensions              | `error`          | `pdf-geometry`  | Page width or height is zero or negative.                                                                                          |
| `PDF-GEOM-002`    | Page has extreme aspect ratio            | `info`           | `pdf-geometry`  | Page aspect ratio exceeds standard boundaries (< 0.2 or > 5.0).                                                                    |
| `PDF-IMAGE-001`   | Raster image rendered without text layer | `info`           | `pdf-image`     | Page renders raster image objects without accompanying text layer.                                                                 |
| `PDF-FONT-001`    | Font embedding boundary inspection       | `info`           | `pdf-font`      | Informs that PDF.js public API verifies font dictionary presence but full PDF/A conformance requires external certified validator. |
