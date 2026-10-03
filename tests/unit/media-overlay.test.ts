import { describe, it, expect } from "vitest";
import {
  parseClockValue,
  parseSmilDocument,
} from "../../packages/epub/src/media-overlay.js";

describe("Media Overlays (EPUB 3.3 SMIL 3.0)", () => {
  describe("parseClockValue", () => {
    it("parses seconds format with s suffix", () => {
      expect(parseClockValue("12.5s")).toBe(12.5);
      expect(parseClockValue("0s")).toBe(0);
      expect(parseClockValue("45s")).toBe(45);
    });

    it("parses milliseconds format with ms suffix", () => {
      expect(parseClockValue("500ms")).toBe(0.5);
      expect(parseClockValue("1500ms")).toBe(1.5);
    });

    it("parses mm:ss and hh:mm:ss clock formats", () => {
      expect(parseClockValue("01:23.5")).toBe(83.5);
      expect(parseClockValue("00:01:23.450")).toBe(83.45);
      expect(parseClockValue("01:00:00")).toBe(3600);
    });

    it("handles null, undefined, empty and invalid values gracefully", () => {
      expect(parseClockValue(null)).toBe(0);
      expect(parseClockValue(undefined)).toBe(0);
      expect(parseClockValue("")).toBe(0);
      expect(parseClockValue("invalid")).toBe(0);
    });
  });

  describe("parseSmilDocument", () => {
    const sampleSmil = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="seq1" epub:textref="chapter1.xhtml">
      <par id="par1">
        <text src="chapter1.xhtml#p1"/>
        <audio src="audio/ch1.mp3" clipBegin="0s" clipEnd="4.5s"/>
      </par>
      <par id="par2">
        <text src="chapter1.xhtml#p2"/>
        <audio src="audio/ch1.mp3" clipBegin="4.5s" clipEnd="10.2s"/>
      </par>
      <par id="par3">
        <text src="chapter1.xhtml#p3"/>
        <audio src="audio/ch2.mp3" clipBegin="00:00:00" clipEnd="00:00:05.500"/>
      </par>
    </seq>
  </body>
</smil>`;

    it("extracts audio-text synchronization segments accurately", () => {
      const doc = parseSmilDocument(sampleSmil, "EPUB/overlay/ch1.smil");
      expect(doc.smilPath).toBe("EPUB/overlay/ch1.smil");
      expect(doc.segments).toHaveLength(3);

      expect(doc.segments[0]?.id).toBe("par1");
      expect(doc.segments[0]?.textRef).toBe("EPUB/overlay/chapter1.xhtml#p1");
      expect(doc.segments[0]?.audio.src).toBe("EPUB/overlay/audio/ch1.mp3");
      expect(doc.segments[0]?.audio.clipBeginSeconds).toBe(0);
      expect(doc.segments[0]?.audio.clipEndSeconds).toBe(4.5);
      expect(doc.segments[0]?.audio.durationSeconds).toBe(4.5);

      expect(doc.segments[1]?.audio.clipBeginSeconds).toBe(4.5);
      expect(doc.segments[1]?.audio.clipEndSeconds).toBe(10.2);
      expect(doc.segments[1]?.audio.durationSeconds).toBeCloseTo(5.7);

      expect(doc.segments[2]?.audio.src).toBe("EPUB/overlay/audio/ch2.mp3");
      expect(doc.segments[2]?.audio.durationSeconds).toBe(5.5);
    });

    it("aggregates audio references and calculates total duration", () => {
      const doc = parseSmilDocument(sampleSmil, "EPUB/overlay/ch1.smil");
      expect(doc.audioReferences).toEqual([
        "EPUB/overlay/audio/ch1.mp3",
        "EPUB/overlay/audio/ch2.mp3",
      ]);
      expect(doc.totalDurationSeconds).toBeCloseTo(15.7);
    });

    it("handles empty or malformed XML safely", () => {
      const doc = parseSmilDocument("<smil></smil>", "empty.smil");
      expect(doc.segments).toEqual([]);
      expect(doc.totalDurationSeconds).toBe(0);
      expect(doc.audioReferences).toEqual([]);
    });
  });
});
