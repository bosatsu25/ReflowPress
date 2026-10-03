import type { AnnotationStore } from "./models.js";

export interface AnnotationRepository {
  load(): Promise<AnnotationStore>;
  save(store: AnnotationStore): Promise<void>;
}
