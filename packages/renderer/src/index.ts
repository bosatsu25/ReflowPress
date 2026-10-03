import type { Renderer } from "@reflowpress/core";

export { ChromiumPdfRenderer } from "./chromium-renderer.js";

/** Type-level contract reserved for the future Vivliostyle integration. */
export interface VivliostyleRenderer extends Renderer {
  readonly id: "vivliostyle";
}
