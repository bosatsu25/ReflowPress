# ADR 0006: Japanese Typography, Accessibility Baseline, and Reusable Typography Architecture

- **Status**: Accepted
- **Date**: 2026-10-03
- **Deciders**: ReflowPress Core & Architecture Team
- **Context**: Milestone 0.6 Japanese Typography & Accessibility

---

## 1. Context and Problem Statement

ReflowPress aims to provide a first-class reading experience for Japanese electronic publications while ensuring that the application chrome and reading surfaces are accessible to all users, including keyboard navigators, screen reader users, and high-contrast environments.

Key technical challenges:

1. **Vertical Japanese Typography (`vertical-rl`)**: Japanese literature is predominantly published in vertical writing with right-to-left block progression. We need to support vertical text layout, ruby phonetic annotations, Japanese line-breaking rules (kinsoku shori), and tate-chu-yoko (horizontal-in-vertical text for digits and acronyms).
2. **Author Styles vs. User Preferences**: Digital publications (EPUB) contain diverse author-defined CSS, including legacy EPUB properties (`-epub-writing-mode`). We must respect publisher intent by default while allowing readers to switch writing modes or typography settings.
3. **Architecture Reuse across Milestones**: The typography profile and CSS generation must be decoupled from the desktop UI to allow direct reuse in Milestone 0.7 (EPUB to PDF / HTML / Markdown export workbench) without duplicating CSS rules.
4. **Accessibility Baseline**: The desktop application must target WCAG 2.2 Level AA accessibility standards, provide full keyboard operability, manage focus correctly across modals and drawers, communicate state changes to assistive technology, and maintain contrast across themes.

---

## 2. Decision Drivers

- **Do Not Reinvent the Typesetting Engine**: Rather than writing a fragile JavaScript-based line breaker or text formatter, rely on modern Chromium standards: CSS Writing Modes, CSS Text, and CSS Ruby.
- **Publication Immutability**: The original publication source files and DOM textContent must never be modified or corrupted.
- **Locator Stability**: Changing writing modes or typography settings must never break existing annotation locators (`TextQuoteSelector`, `TextPositionSelector`).
- **Sandbox Security**: Never enable `allow-scripts` in publication iframes to implement typography features.
- **Portability**: Keep the typography domain logic in a UI-independent package (`@reflowpress/typography`).
- **Targeted Accessibility Claims**: Target WCAG 2.2 Level AA without overclaiming formal certification.

---

## 3. Evaluated Decisions

### 3.1 Typography Implementation Strategy: Native Standards vs. Custom Engine

- **Option A (Custom JS Typesetting Engine)**: Implement custom line-breaking, glyph positioning, and pagination algorithms (e.g. recreating TeX/InDesign layout in JS).
  - _Cons_: Extremely complex, fragile, slow, violates standards, causes severe maintenance burden.
  - _Decision_: **Rejected**.
- **Option B (Chromium Standards Engine)**: Leverage Chromium's built-in CSS Writing Modes Level 3/4 (`writing-mode: vertical-rl; text-orientation: mixed;`), CSS Text Level 3/4 (`line-break: strict;`), and CSS Ruby.
  - _Pros_: Fast, hardware accelerated, specification-compliant, zero extra bundle weight.
  - _Decision_: **Accepted**.

### 3.2 Typography Architecture: Package Separation

- We create **`@reflowpress/typography`** (`packages/typography/`) as a pure domain package.
- _Responsibilities_:
  - Typography types and models (`WritingMode`, `TextDirection`, `JapaneseTypographySettings`, `TypographyProfile`).
  - CSS injection generators (`generateTypographyCss`, `normalizeLegacyEpubCss`).
  - Reading flow calculation (`resolveReadingFlow`, `calculateNextProgressionDelta`).
  - Safe assist transforms for Tate-chu-yoko (TCY).
- _Reuse in Milestone 0.7_: When EPUB is converted to PDF via headless browser printing, `@reflowpress/typography` supplies the exact same stylesheet and layout rules, preventing divergent layout engines between Reader and Exporter.

### 3.3 Author Styles vs. Reader Overrides (`writing-mode: auto`)

- **Default (`auto`)**: The reader respects the publisher's stylesheet, HTML attributes (`dir`), and OPF metadata (`page-progression-direction`). If the publication specifies vertical writing via standard or `-epub-` properties, it renders vertically.
- **Explicit Override (`horizontal` | `vertical`)**: When the user explicitly selects a writing mode, a scoped CSS class (`.reflowpress-reading-mode-vertical` or `.reflowpress-reading-mode-horizontal`) is applied to the reading container to override the root flow safely without mutating publisher CSS declarations.

### 3.4 Kinsoku Shori (Japanese Line-Breaking)

- Configured via CSS Text Level 3 standard properties:
  ```css
  line-break: strict;
  word-break: normal;
  overflow-wrap: normal;
  ```
- Chromium enforces standard Japanese prohibited line-start characters (e.g., `。`, `、`, `」`, `）`) and prohibited line-end characters (e.g., `「`, `（`).
- ReflowPress explicitly does not claim "100% JIS X 4051 certified conformance"; rather, it guarantees standards-based strict line-breaking through the browser layout engine.

### 3.5 Ruby Annotations

- `<ruby>`, `<rt>`, and `<rp>` tags are strictly preserved by the XHTML sanitizer.
- Rendered natively using Chromium's CSS Ruby engine.
- Base text remains contiguous in the DOM to preserve `TextQuoteSelector` and search indexing integrity.
- In-book search matches the base text by default; ruby pronunciations are indexed alongside without fragmenting base text.

### 3.6 Tate-chu-yoko (TCY)

- **Author Mode (Default)**: Respects publisher markup using `text-combine-upright: all` or legacy `-epub-text-combine: horizontal`.
- **Assist Mode**: Automatically wraps 1–2 digit ASCII numerals in vertical mode within `<span class="reflowpress-tcy" style="text-combine-upright: all;">` during sanitized presentation.
  - _Guarantees_: Idempotent, non-destructive, does not alter `textContent`, preserves character offsets for annotation locators.
- **Off Mode**: Disables TCY styling.

### 3.7 Axis-Aware Navigation

- In `horizontal-tb`, forward progression moves downward (Y-axis scrolling) or to the right (X-axis paging).
- In `vertical-rl`, columns progress from right to left (negative horizontal delta).
- `ReadingFlow` abstraction maps keyboard controls (`PageDown`, `Space`, `ArrowLeft`, `ArrowRight`) to the correct geometric progression direction based on computed writing mode.

### 3.8 Keyboard, Focus, and Semantic ARIA Architecture

- **Semantic First**: Use native `<button>`, `<input>`, `<nav>`, `<main>`, `<dialog>`, and `<aside>` elements with visible `:focus-visible` styling.
- **Dialogs & Modals**: Manage focus using `role="dialog"`, `aria-modal="true"`, accessible labeling (`aria-labelledby`), trap containment, Escape key dismissal, and focus restoration to the originating trigger upon close.
- **Drawers**: Non-modal accessible side panels with logical tab order, accessible headings, and focus return.
- **Screen Reader Announcements**: An unobtrusive `aria-live="polite"` region communicates asynchronous events (page change, search completion, bookmark saved, import finished).
- **Shortcut Safety**: Navigation hotkeys are suppressed when focus is within text inputs or editable elements.

### 3.9 Automated Accessibility Testing & Claims

- Automated verification using `@axe-core/playwright` scanning all major application views (Library, Reader, Drawers, Dialogs).
- Definition of Done requires **0 critical and 0 serious violations**.
- Claims boundary: We document "automated accessibility baseline verified against WCAG 2.2 AA rules", but do not claim formal third-party certification.

### 3.10 RTL and MathML Foundation

- **RTL / Bidi**: HTML `dir="rtl"` and EPUB `page-progression-direction="rtl"` are preserved and mapped to CSS direction, allowing native bidirectional rendering.
- **MathML Core**: MathML elements (`<math>`, `<mrow>`, `<mi>`, `<mo>`, `<msup>`) are permitted in the sanitizer and rendered natively via Chromium MathML Core.

---

## 4. Consequences

### Positive

- Unified typography package shared across Desktop Reader and Export Workbench.
- Zero extra dependencies for typography layout; uses standard Chromium capabilities.
- Full keyboard and screen reader accessibility baseline verified by automated axe tests.
- High resilience of annotation locators and search across writing mode changes.

### Neutral / Constraints

- Precise line breaking and hyphenation remain dependent on Chromium's underlying platform implementation.
- Assist TCY is limited to unambiguous 1–2 digit numeral patterns to prevent false positives in mixed text.
- Full formal WCAG certification and comprehensive screen-reader testing across JAWS/NVDA/VoiceOver remain separate manual processes.
