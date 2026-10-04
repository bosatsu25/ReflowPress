# Accessibility Statement

ReflowPress is committed to providing a fully accessible reading and digital library workbench for all users, including those relying on screen readers, keyboard-only navigation, high contrast modes, and assistive technologies.

---

## Conformance Standards & Baseline

ReflowPress targets the **Web Content Accessibility Guidelines (WCAG) 2.2 Level AA** standard.

### Core Accessibility Features

1. **Full Keyboard Operability**:
   - Every interactive control (library cards, reader paging, TOC drawer, health modal, settings, export controls) is accessible via standard keyboard navigation (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`, arrow keys).
   - Dialogs and slide-over drawers implement strict focus trapping on open and restore previous focus to the triggering element upon closure.

2. **Visual Ergonomics & Themes**:
   - ReflowPress provides built-in high-contrast color themes: Light, Dark, and Sepia.
   - Contrast ratios for core text and interactive elements meet or exceed the WCAG AA minimum of **4.5:1** (normal text) and **3:1** (large text and UI components).
   - Native support for operating system `prefers-contrast: more` and Windows Forced Colors mode.

3. **Screen Reader Support & ARIA**:
   - Modal dialogs utilize `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
   - Dynamic asynchronous updates (repair progress, sync status, reading position saving) publish polite announcements via `aria-live="polite"` regions.
   - Japanese ruby text provides fallback pronunciation structures compatible with speech synthesis.

4. **Motor & Motion Sensitivity**:
   - Smooth scrolling and page transition animations strictly respect `prefers-reduced-motion: reduce`.
   - Clickable targets maintain a minimum dimension of **24x24 CSS pixels** to prevent accidental activations.

---

## Certification Status Disclaimer

> [!IMPORTANT]
> **ReflowPress has not been evaluated or certified by an external, accredited third-party accessibility auditing firm.**
>
> While our test suite incorporates continuous automated testing using `@axe-core/playwright` and manual verification against WCAG 2.2 AA criteria, formal external certification has not been obtained.
>
> If you encounter any barriers or accessibility defects, please open an issue on our GitHub repository.
