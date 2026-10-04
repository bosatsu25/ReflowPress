# ReflowPress User Guide

Welcome to **ReflowPress**, the free, local-first electronic publication workbench for reading, organizing, searching, annotating, inspecting, safely repairing, exporting, and synchronizing EPUB and PDF books.

---

## 1. Getting Started

### Launching the Desktop Application
- **Standard Launch**: Launch ReflowPress from your application menu or run `npx electron apps/desktop/dist/main/main.js`.
- **Open a Specific Publication**: Pass the file path as an argument or flag:
  ```sh
  npx electron apps/desktop/dist/main/main.js --open /path/to/book.epub
  ```

### Using the Headless CLI
ReflowPress includes a powerful CLI (`reflowpress`) for automated batch processing, headless exporting, inspection, repair, and synchronization:
```sh
# Display help and command options
reflowpress --help
```

---

## 2. Reading Workbench

### Reading Reflowable EPUB Books
- **Navigation**:
  - `ArrowLeft` / `PageUp`: Move to previous page / column.
  - `ArrowRight` / `PageDown`: Move to next page / column.
  - `Home` / `End`: Jump to beginning or end of current section.
- **Table of Contents (TOC)**:
  - Click the **TOC** icon in the header (or press `Ctrl+T` / `Cmd+T`) to slide out the hierarchical navigation drawer.
  - Click any chapter to jump directly to it.
- **Typography & Themes**:
  - Click the **Settings** gear icon in the header.
  - **Themes**: Light, Dark, and Sepia.
  - **Font Size & Line Height**: Adjustable font scaling (12px–32px) and line spacing (1.2–2.4).
  - **Margins**: Customizable left/right reading gutters.

### Japanese Typography (`vertical-rl`)
- ReflowPress provides first-class support for Japanese text layout:
  - **Vertical Writing Mode**: Automatically activates for publications specifying vertical direction (`vertical-rl`), or can be toggled manually.
  - **Ruby Support**: Full native `<ruby>` rendering with `<rt>` and `<rp>` pronunciation guides.
  - **Kinsoku Shori**: Strict line-breaking rules preventing punctuation marks from appearing at the start of lines or opening quotes at the end.
  - **Tate-chu-yoko (TCY)**: Horizontal numeral alignment for 1–3 digit numbers inside vertical text columns.
  - **Axis-Aware Navigation**: In vertical writing mode, `ArrowLeft` advances to the next column (progressing right-to-left) and `ArrowRight` retreats to the previous column.

### Reading Fixed-Layout PDF Documents
- High-fidelity PDF viewing powered by PDF.js with text selection and high-DPI scaling.
- Zoom controls: 50% to 300% zoom with fit-to-width support.
- Full keyboard page navigation (`PageUp`, `PageDown`, `Home`, `End`).

---

## 3. Library Management

- **Add Files**: Click **Add Books** in the Library View or drag and drop `.epub` and `.pdf` files.
- **Scan Directory**: Click **Add Folder** to recursively scan local directories. ReflowPress discovers publications incrementally and extracts cover art without moving or altering original files.
- **Collections & Shelves**: Create custom shelves (e.g. "Favorites", "Technical References") to organize books.
- **Search & Filter**: Search across titles, authors, publishers, or tags in real time with sub-millisecond responsiveness.

---

## 4. Reading Tools (Search, Notes & Annotations)

- **In-Book Search**:
  - Press `Ctrl+F` / `Cmd+F` or open the Tools Drawer and select the Search tab.
  - Type a keyword to perform a streaming, background search across all sections or pages with context snippets.
  - Click any search result to jump directly to that exact text location.
- **Highlights & Notes**:
  - Select any text in an EPUB or PDF to summon the floating selection toolbar.
  - Choose a highlight color (Yellow, Green, Blue, Pink, Purple).
  - Optionally attach an annotation note to the selection.
- **Bookmarks**:
  - Press the bookmark icon in the header or use `Ctrl+D` to save the exact reading location.
- **Exporting Annotations**:
  - Export your highlights and notes into Markdown (with YAML frontmatter), standalone HTML, or structured JSON for Obsidian, Logseq, or other PKM tools.

---

## 5. Export Workbench

ReflowPress converts EPUB publications into high-fidelity PDFs, standalone single-file HTML archives, and GitHub-Flavored Markdown:

### Headless CLI Export
```sh
# Export single book to PDF with A4 page size
reflowpress export book.epub --format pdf --page-size A4 --output-dir ./exports

# Batch export all books in a folder with 4 parallel jobs
reflowpress export ./my-library --recursive --format pdf --jobs 4

# Export to standalone HTML with inlined Data URL images and styles
reflowpress export book.epub --format html

# Export to Markdown with ruby text transliterated to Japanese reading format
reflowpress export book.epub --format markdown
```

---

## 6. Publication Quality & Safe Repair

### Health Diagnostics
- Press the **Health** button in the Desktop Workbench or run `reflowpress inspect book.epub`.
- ReflowPress runs automated diagnostic rules (`EPUB-MIME-001`, `EPUB-NAV-001`, `EPUB-MEDIA-001`, `EPUB-OVERLAY-001`, etc.) detecting package defects, missing navigation documents, broken manifest paths, and unreferenced resources.

### Non-Destructive Safe Repair
- ReflowPress repairs broken EPUBs **without modifying the original file**:
  - Rewrites uncompressed `mimetype` headers to byte offset 38.
  - Synthesizes compliant `META-INF/container.xml` if missing.
  - Corrects non-standard manifest media types.
  - Generates a sidecar `.provenance.json` recording every modified entry, checksum, and diagnostic justification.
```sh
# Preview safe repairs without writing changes
reflowpress repair defective.epub

# Apply safe repairs to a designated output folder
reflowpress repair defective.epub --apply --output-dir ./repaired
```

---

## 7. Interoperability & Sync

### Local OPDS 2.0 Catalog Server
Stream your local library catalog to OPDS 2.0 compatible readers on your local network (e.g. Moon+ Reader, Panels, Thorium):
```sh
# Serve local library catalog on port 8080
reflowpress opds serve --port 8080 --catalog ./library.json --allow-lan
```

### Shared Folder Synchronization (Syncthing / Dropbox)
Sync reading progress, bookmarks, and collections across multiple computers via a local shared folder:
```sh
# Synchronize with shared folder
reflowpress sync folder --target /path/to/SyncFolder --catalog ./library.json
```

### Hardware E-Reader Device Transfer
Transfer publications directly over USB to Amazon Kindle, Rakuten Kobo, PocketBook, and generic USB ereaders:
```sh
# List connected device mount point
reflowpress device list --target /Volumes/KOBOeReader

# Copy books safely to device with directory traversal protection
reflowpress device send /Volumes/KOBOeReader book.epub
```

---

## 8. Crash Recovery & Session Restoration

- If ReflowPress experiences an unexpected power loss or process kill, your user data is protected:
  - Atomic writes (`write` \(\to\) `fsync` \(\to\) `rename`) prevent half-written file corruption.
  - Orphaned temporary files (`.tmp-*`) are automatically swept and pruned on startup.
  - The application detects abnormal terminations and presents a non-intrusive **Recovery Banner** offering to restore your last active reading workspace and position.
