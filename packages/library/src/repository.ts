import type { LibraryCatalog } from "./models.js";

export interface LibraryRepository {
  load(): Promise<LibraryCatalog>;
  save(catalog: LibraryCatalog): Promise<void>;
}
