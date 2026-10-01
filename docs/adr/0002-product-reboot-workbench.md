# ADR 0002: Product Reboot to Local-First Ebook Workbench

- Status: Accepted
- Date: 2026-10-02
- Supersedes: Expands upon [ADR 0001](0001-layered-publication-pipeline.md) without invalidating its layered pipeline architecture.

## Context

ReflowPress was initially scoped as an automated EPUB-to-PDF conversion tool. Phase 1 successfully established repository foundations and implemented the EPUB Inspector, demonstrating robust archive validation, OPF parsing, and safety bounds checking.

However, proceeding directly to PDF output generation (previously Phase 2) before establishing a generic publication loading model would introduce structural issues:

1. **Duplicate Parsers**: The parser built strictly for PDF export would likely need heavy refactoring or duplication once EPUB reading and library capabilities are added.
2. **Narrow Value Proposition**: Pure EPUB-to-PDF conversion addresses only a sliver of modern document workflows. Readers need a reliable, private tool to read, organize, annotate, inspect, and repair publications without vendor lock-in or cloud surveillance.
3. **Reference Product Gap**: Millions of users rely on Adobe Digital Editions (ADE) 4.5.x for basic reading and library duties despite its aging architecture, lack of diagnostic tools, and proprietary cloud entanglements.

## Decision

1. **Product Redefinition**: Redefine ReflowPress as a **free, local-first workbench for reading, organizing, inspecting, repairing, searching, annotating, and exporting EPUB and PDF publications**.
2. **Publication Core Priority**: Elevate the shared publication data pipeline into **Publication Core (Milestone 0.2)**. Both the reader interface and the export engines will consume this identical normalized publication abstraction.
3. **Adopt Milestone Roadmap**: Transition from Phase numbers to Milestone releases (0.1 Foundation, 0.2 Publication Core, 0.3 Reader MVP, 0.4 Library MVP, 0.5 Reading Tools, 0.6 Japanese & Accessibility, 0.7 Export Workbench, 0.8 Quality & Repair, 0.9 Interoperability, 1.0 Stable Release).
4. **ADE Functional Parity with Differentiators**: Use ADE 4.5.x as a baseline reference for reading and cataloging, while establishing distinct differentiators: Publication Health inspection, explainable Safe Repair, portable annotations, advanced multi-scoped search, and the PDF Quality Gate.
5. **Strict Offline & Optional AI**: Ensure core workbench features operate completely offline with zero telemetry and no mandatory cloud accounts. AI tools are strictly optional downstream consumers of exported data.

## Consequences

### Positive

- **Architectural Cohesion**: Reading, search indexing, repair, and export share a single normalized data representation, eliminating redundant parsing logic.
- **Clear Product Identity**: ReflowPress moves beyond a developer script into a resilient, user-facing electronic document workbench.
- **Sound Quality Foundation**: The diagnostic engine developed in Phase 1 naturally expands into publication repair and quality assurance features.

### Negative / Trade-offs

- **Export Timeline Shift**: The standalone EPUB-to-PDF CLI output moves from the immediate next task to Milestone 0.7. However, when delivered, the exporter will benefit from a battle-tested publication model rather than a brittle one-off converter.

## Alternatives Considered

1. **Proceed directly with EPUB-to-PDF CLI (Phase 2)**:
   - _Rejected_: Would force a quick-and-dirty EPUB content extractor tailored solely for PDF rendering, necessitating a costly re-write when building the reader in Phase 5.
2. **Replicate Adobe Digital Editions Proprietary Protocols / DRM**:
   - _Rejected_: Incompatible with our core principles. Violates non-goals regarding DRM circumvention, introduces legal risk, and distracts from open web standard document processing.
3. **Cloud-Hosted Reading & Conversion Service**:
   - _Rejected_: Contradicts our Local-First and Privacy-by-Default principles. Users should never be forced to upload their personal reading libraries to remote servers.
