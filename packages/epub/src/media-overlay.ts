import { parseXml } from "./xml.js";
import { resolveArchiveReference } from "./path.js";

export interface MediaOverlayAudioClip {
  readonly src: string;
  readonly clipBeginSeconds: number;
  readonly clipEndSeconds: number;
  readonly durationSeconds: number;
}

export interface MediaOverlaySegment {
  readonly id?: string | undefined;
  readonly textRef: string;
  readonly audio: MediaOverlayAudioClip;
}

export interface MediaOverlayDocument {
  readonly smilPath: string;
  readonly segments: readonly MediaOverlaySegment[];
  readonly totalDurationSeconds: number;
  readonly audioReferences: readonly string[];
}

export interface PublicationMediaOverlaysReport {
  readonly hasMediaOverlays: boolean;
  readonly totalDurationSeconds: number;
  readonly documents: readonly MediaOverlayDocument[];
  readonly missingAudioFiles: readonly string[];
}

/**
 * Parses SMIL clock values (e.g. "00:01:23.450", "01:23.5", "45.2s", "500ms").
 * Returns time in seconds.
 */
export function parseClockValue(val: string | null | undefined): number {
  if (!val) return 0;
  const s = val.trim();

  // Seconds format: "12.5s"
  if (s.endsWith("s") && !s.endsWith("ms")) {
    const num = parseFloat(s.slice(0, -1));
    return isNaN(num) ? 0 : Math.max(0, num);
  }

  // Milliseconds format: "500ms"
  if (s.endsWith("ms")) {
    const num = parseFloat(s.slice(0, -2));
    return isNaN(num) ? 0 : Math.max(0, num / 1000);
  }

  // Clock format: [[HH:]MM:]SS[.mmm]
  const parts = s.split(":");
  if (parts.length === 3) {
    const hours = parseFloat(parts[0] ?? "0") || 0;
    const minutes = parseFloat(parts[1] ?? "0") || 0;
    const seconds = parseFloat(parts[2] ?? "0") || 0;
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0] ?? "0") || 0;
    const seconds = parseFloat(parts[1] ?? "0") || 0;
    return Math.max(0, minutes * 60 + seconds);
  }

  const raw = parseFloat(s);
  return isNaN(raw) ? 0 : Math.max(0, raw);
}

/**
 * Safely parses a SMIL 3.0 document XML for EPUB 3 Media Overlays.
 */
export function parseSmilDocument(
  smilXml: string,
  smilPath: string,
): MediaOverlayDocument {
  const doc = parseXml(
    smilXml,
    (msg) => new Error(`SMIL XML parsing error: ${msg}`),
  );
  const smilRoot = doc.documentElement;
  if (!smilRoot || smilRoot.localName !== "smil") {
    throw new Error(
      `Invalid SMIL root element: expected <smil>, got <${smilRoot?.localName}>`,
    );
  }

  const smilDir = smilPath.includes("/")
    ? smilPath.slice(0, smilPath.lastIndexOf("/"))
    : "";

  const parElements = doc.getElementsByTagName("par");
  const segments: MediaOverlaySegment[] = [];
  const audioSet = new Set<string>();
  let calculatedDuration = 0;

  for (let i = 0; i < parElements.length; i++) {
    const par = parElements[i];
    if (!par) continue;

    const textEl = par.getElementsByTagName("text")[0];
    const audioEl = par.getElementsByTagName("audio")[0];

    if (!textEl || !audioEl) continue;

    const rawTextSrc = textEl.getAttribute("src") ?? "";
    const rawAudioSrc = audioEl.getAttribute("src") ?? "";
    if (!rawAudioSrc) continue;

    const resolvedAudioSrc = resolveArchiveReference(smilDir, rawAudioSrc);
    audioSet.add(resolvedAudioSrc);

    let resolvedTextRef = rawTextSrc;
    if (rawTextSrc) {
      const [textPathPart, fragment] = rawTextSrc.split("#", 2);
      if (textPathPart) {
        const resolvedPath = resolveArchiveReference(smilDir, textPathPart);
        resolvedTextRef =
          fragment !== undefined ? `${resolvedPath}#${fragment}` : resolvedPath;
      }
    }

    const clipBegin = parseClockValue(audioEl.getAttribute("clipBegin"));
    const clipEnd = parseClockValue(audioEl.getAttribute("clipEnd"));
    const duration = clipEnd > clipBegin ? clipEnd - clipBegin : 0;

    calculatedDuration += duration;

    segments.push({
      id: par.getAttribute("id") ?? undefined,
      textRef: resolvedTextRef,
      audio: {
        src: resolvedAudioSrc,
        clipBeginSeconds: clipBegin,
        clipEndSeconds: clipEnd,
        durationSeconds: duration,
      },
    });
  }

  return {
    smilPath,
    segments,
    totalDurationSeconds: calculatedDuration,
    audioReferences: Array.from(audioSet),
  };
}
