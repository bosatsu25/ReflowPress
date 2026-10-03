import type { PublicationAdapter, PublicationSource } from "@reflowpress/core";

export {
  EpubInspectionError,
  inspectEpub,
  type EpubInspection,
  type EpubInspectionErrorCode,
  type EpubInspectionLimits,
  type EpubManifestItem,
  type EpubMetadata,
  type EpubSpineItem,
} from "./inspect.js";

export {
  EpubLoader,
  loadEpub,
  EpubLoadingError,
  DEFAULT_LOADER_LIMITS,
  type EpubLoadingErrorCode,
  type EpubLoaderLimits,
  type EpubSource,
} from "./loader.js";

export { parseNavDocument, parseNcxDocument } from "./navigation.js";
export * from "./media-overlay.js";

export interface EpubPublicationAdapter extends PublicationAdapter<PublicationSource> {
  readonly id: "epub";
}
