# EPUB 3.3 Media Overlays & Audio-Text Synchronization

ReflowPress includes parser and reporting infrastructure for EPUB 3.3 Media Overlays (SMIL 3.0), enabling synchronized text highlighting and narration audio playback.

---

## 1. Specification Compliance

- **Standards Grounding**: Complies with the W3C EPUB 3.3 Media Overlays specification and W3C SMIL 3.0.
- **Clock Values**: Supports standard SMIL clock formats via `parseClockValue`:
  - Seconds syntax: `12.5s`, `0s`
  - Milliseconds syntax: `500ms`, `1500ms`
  - Clock formats: `mm:ss`, `hh:mm:ss`, and fractional milliseconds `00:01:23.450`
- **Synchronization Elements**: Parses `<seq>` and `<par>` parallel synchronization structures linking XHTML text fragment identifiers (e.g. `chapter1.xhtml#p1`) with audio clips (`audio/ch1.mp3`) bounded by `clipBegin` and `clipEnd`.

---

## 2. Media Overlays Reporting & Inspection

When inspecting publications via the ReflowPress inspection suite or CLI, Media Overlays metadata is automatically extracted:

- **Total Duration**: Aggregate playback duration calculated across all synchronized segments.
- **Audio References**: Deduped catalog of referenced audio assets within the EPUB archive.
- **Integrity Validation**: Verifies that audio files declared in SMIL documents exist within the publication package and reports missing audio assets.

---

## 3. CLI & Inspection Integration

```bash
# Inspect publication health including Media Overlays audio synchronization
reflowpress inspect audiobook.epub --json
```

Output includes structured Media Overlays metrics:

```json
{
  "mediaOverlays": {
    "hasMediaOverlays": true,
    "totalDurationSeconds": 1420.5,
    "documentCount": 12,
    "missingAudioFiles": []
  }
}
```
