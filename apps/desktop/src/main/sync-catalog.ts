import type { LibraryBook } from "@reflowpress/library";

export { syncRecordsToCatalogBooks } from "@reflowpress/sync";

/** Fields the renderer may change on an existing book. */
export function pickEditableBookFields(
  updates: unknown,
): Partial<Pick<LibraryBook, "lastOpened" | "tags" | "readingProgress">> {
  if (!updates || typeof updates !== "object") return {};
  const source = updates as Record<string, unknown>;
  const picked: Partial<
    Pick<LibraryBook, "lastOpened" | "tags" | "readingProgress">
  > = {};

  if (typeof source.lastOpened === "string") {
    picked.lastOpened = source.lastOpened;
  }
  if (
    Array.isArray(source.tags) &&
    source.tags.every((tag) => typeof tag === "string")
  ) {
    picked.tags = [...(source.tags as string[])];
  }
  const progress = source.readingProgress;
  if (
    progress &&
    typeof progress === "object" &&
    typeof (progress as Record<string, unknown>).updatedAt === "string"
  ) {
    const { location, percentage, updatedAt } = progress as Record<
      string,
      unknown
    >;
    picked.readingProgress = {
      updatedAt: updatedAt as string,
      ...(typeof location === "string" ? { location } : {}),
      ...(typeof percentage === "number" && Number.isFinite(percentage)
        ? { percentage }
        : {}),
    };
  }
  return picked;
}
