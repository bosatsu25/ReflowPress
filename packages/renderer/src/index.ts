import type { Renderer } from "@reflowpress/core";

export {
  ChromiumPdfRenderer,
  buildPrintDocument,
  CHROMIUM_NO_SANDBOX_ENV,
  DEFAULT_RENDER_TIMEOUT_MS,
  isChromiumSandboxOptOut,
  type ChromiumPdfRendererOptions,
  type PrintContentSanitizer,
  type PrintDocument,
  type RendererEnvironment,
  type SanitizedPrintContent,
  type SanitizedPrintSection,
} from "./chromium-renderer.js";

/** Type-level contract reserved for the future Vivliostyle integration. */
export interface VivliostyleRenderer extends Renderer {
  readonly id: "vivliostyle";
}
