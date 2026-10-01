import type { PublicationSection } from "@reflowpress/core";

export const MIN_PDF_ZOOM = 0.25;
export const MAX_PDF_ZOOM = 4.0;
export const DEFAULT_PDF_ZOOM = 1.0;
export const PDF_ZOOM_STEP = 0.25;

export function getNextSectionIndex(
  currentIndex: number,
  totalSections: number,
): number {
  if (totalSections <= 0) return 0;
  return Math.min(currentIndex + 1, totalSections - 1);
}

export function getPreviousSectionIndex(currentIndex: number): number {
  return Math.max(currentIndex - 1, 0);
}

export function findSectionIndexByHref(
  sections: readonly PublicationSection[],
  targetHref: string,
): number {
  if (!targetHref || sections.length === 0) return -1;
  const targetWithoutFragment = targetHref.split("#", 1)[0] ?? "";

  // 1. Exact match on full href
  const exactIndex = sections.findIndex((s) => s.href === targetHref);
  if (exactIndex !== -1) return exactIndex;

  // 2. Match without fragment
  const pathIndex = sections.findIndex(
    (s) => s.href.split("#", 1)[0] === targetWithoutFragment,
  );
  if (pathIndex !== -1) return pathIndex;

  // 3. Normalized basename / relative match
  return sections.findIndex(
    (s) =>
      s.href.endsWith(`/${targetWithoutFragment}`) ||
      targetWithoutFragment.endsWith(`/${s.href}`),
  );
}

export function clampPdfPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || totalPages <= 0) return 1;
  return Math.min(Math.max(Math.floor(page), 1), totalPages);
}

export function clampPdfZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_PDF_ZOOM;
  const rounded = Math.round(zoom * 100) / 100;
  return Math.min(Math.max(rounded, MIN_PDF_ZOOM), MAX_PDF_ZOOM);
}
