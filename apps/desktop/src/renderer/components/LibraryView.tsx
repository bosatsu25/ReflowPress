import React, { useState, useEffect, useMemo } from "react";
import {
  type LibraryBook,
  type LibraryCatalog,
  type BookSortCriteria,
  type PublicationFormat,
  filterBooks,
  sortBooks,
} from "@reflowpress/library";
import type { ReaderSettings } from "@reflowpress/reader";
import { desktopBridge } from "../adapter/desktop-bridge.js";

export interface LibraryViewProps {
  catalog: LibraryCatalog;
  theme: ReaderSettings["theme"];
  onOpenBook: (book: LibraryBook) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onRemoveBook: (bookId: string) => void;
  onCreateCollection: (name: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onAddBookToCollection: (bookId: string, collectionId: string) => void;
  onRemoveBookFromCollection: (bookId: string, collectionId: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  catalog,
  theme,
  onOpenBook,
  onAddFiles,
  onAddFolder,
  onRemoveBook,
  onCreateCollection,
  onDeleteCollection,
  onAddBookToCollection,
  onRemoveBookFromCollection,
}) => {
  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<
    PublicationFormat | "all"
  >("all");
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | undefined
  >(undefined);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
  const [sortCriteria, setSortCriteria] = useState<BookSortCriteria>({
    field: "dateAdded",
    direction: "desc",
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  // Load cover images asynchronously
  useEffect(() => {
    let isMounted = true;
    for (const book of catalog.books) {
      if (book.coverPath && !covers[book.id]) {
        desktopBridge
          .readCoverImage(book.coverPath)
          .then((dataUri) => {
            if (isMounted && dataUri) {
              setCovers((prev) => ({ ...prev, [book.id]: dataUri }));
            }
          })
          .catch(() => {});
      }
    }
    return () => {
      isMounted = false;
    };
  }, [catalog.books, covers]);

  // Aggregate distinct tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const b of catalog.books) {
      for (const t of b.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [catalog.books]);

  // Filtered and sorted books
  const displayBooks = useMemo(() => {
    const filtered = filterBooks(catalog.books, {
      query: searchQuery,
      format: selectedFormat,
      collectionId: selectedCollectionId,
      tag: selectedTag,
    });
    return sortBooks(filtered, sortCriteria);
  }, [
    catalog.books,
    searchQuery,
    selectedFormat,
    selectedCollectionId,
    selectedTag,
    sortCriteria,
  ]);

  // Counts
  const epubCount = useMemo(
    () => catalog.books.filter((b) => b.format === "epub").length,
    [catalog.books],
  );
  const pdfCount = useMemo(
    () => catalog.books.filter((b) => b.format === "pdf").length,
    [catalog.books],
  );

  // Theme Colors
  const bg = isDark ? "#121212" : isSepia ? "#fbf0d9" : "#f9fafb";
  const sidebarBg = isDark ? "#1a1a1a" : isSepia ? "#f4ebd0" : "#ffffff";
  const cardBg = isDark ? "#242424" : isSepia ? "#eedcba" : "#ffffff";
  const textColor = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#111827";
  const mutedText = isDark ? "#9ca3af" : isSepia ? "#78654e" : "#6b7280";
  const borderColor = isDark ? "#333333" : isSepia ? "#dfcfb0" : "#e5e7eb";
  const accentColor = isDark ? "#3b82f6" : isSepia ? "#8f5727" : "#2563eb";

  const handleCreateCollectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCollectionName.trim()) {
      onCreateCollection(newCollectionName.trim());
      setNewCollectionName("");
      setIsCreatingCollection(false);
    }
  };

  return (
    <div
      className="library-view"
      style={{
        display: "flex",
        flex: 1,
        height: "100%",
        overflow: "hidden",
        backgroundColor: bg,
        color: textColor,
        userSelect: "none",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: "240px",
          minWidth: "200px",
          backgroundColor: sidebarBg,
          borderRight: `1px solid ${borderColor}`,
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          overflowY: "auto",
        }}
      >
        {/* Navigation Categories */}
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: mutedText,
              marginBottom: "8px",
              paddingLeft: "8px",
            }}
          >
            Library
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedFormat("all");
              setSelectedCollectionId(undefined);
              setSelectedTag(undefined);
            }}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "6px",
              border: "none",
              backgroundColor:
                selectedFormat === "all" &&
                !selectedCollectionId &&
                !selectedTag
                  ? isDark
                    ? "#333333"
                    : isSepia
                      ? "#e5d4b4"
                      : "#e5e7eb"
                  : "transparent",
              color: textColor,
              cursor: "pointer",
              fontWeight:
                selectedFormat === "all" &&
                !selectedCollectionId &&
                !selectedTag
                  ? 600
                  : 400,
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <span>📚 All Books</span>
            <span style={{ fontSize: "12px", color: mutedText }}>
              {catalog.books.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedFormat("epub");
              setSelectedCollectionId(undefined);
              setSelectedTag(undefined);
            }}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "6px",
              border: "none",
              backgroundColor:
                selectedFormat === "epub" &&
                !selectedCollectionId &&
                !selectedTag
                  ? isDark
                    ? "#333333"
                    : isSepia
                      ? "#e5d4b4"
                      : "#e5e7eb"
                  : "transparent",
              color: textColor,
              cursor: "pointer",
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <span>📖 EPUB</span>
            <span style={{ fontSize: "12px", color: mutedText }}>
              {epubCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedFormat("pdf");
              setSelectedCollectionId(undefined);
              setSelectedTag(undefined);
            }}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "6px",
              border: "none",
              backgroundColor:
                selectedFormat === "pdf" &&
                !selectedCollectionId &&
                !selectedTag
                  ? isDark
                    ? "#333333"
                    : isSepia
                      ? "#e5d4b4"
                      : "#e5e7eb"
                  : "transparent",
              color: textColor,
              cursor: "pointer",
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <span>📄 PDF</span>
            <span style={{ fontSize: "12px", color: mutedText }}>
              {pdfCount}
            </span>
          </button>
        </div>

        {/* Collections / Shelves */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
              paddingLeft: "8px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: mutedText,
              }}
            >
              Collections
            </span>
            <button
              type="button"
              onClick={() => setIsCreatingCollection(true)}
              title="Add Collection"
              style={{
                background: "transparent",
                border: "none",
                color: accentColor,
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              +
            </button>
          </div>

          {isCreatingCollection && (
            <form
              onSubmit={handleCreateCollectionSubmit}
              style={{ marginBottom: "8px", padding: "0 4px" }}
            >
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                placeholder="Collection name..."
                autoFocus
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: `1px solid ${borderColor}`,
                  backgroundColor: bg,
                  color: textColor,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    padding: "4px",
                    fontSize: "11px",
                    backgroundColor: accentColor,
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingCollection(false)}
                  style={{
                    flex: 1,
                    padding: "4px",
                    fontSize: "11px",
                    backgroundColor: "transparent",
                    color: mutedText,
                    border: `1px solid ${borderColor}`,
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {catalog.collections.length === 0 && !isCreatingCollection && (
            <div
              style={{
                fontSize: "12px",
                color: mutedText,
                paddingLeft: "8px",
                fontStyle: "italic",
              }}
            >
              No collections yet
            </div>
          )}

          {catalog.collections.map((c) => {
            const count = catalog.books.filter((b) =>
              b.collectionIds.includes(c.id),
            ).length;
            const isSelected = selectedCollectionId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: "6px",
                  backgroundColor: isSelected
                    ? isDark
                      ? "#333333"
                      : isSepia
                        ? "#e5d4b4"
                        : "#e5e7eb"
                    : "transparent",
                  padding: "4px 8px",
                  marginBottom: "2px",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCollectionId(c.id);
                    setSelectedFormat("all");
                    setSelectedTag(undefined);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: textColor,
                    cursor: "pointer",
                    fontSize: "13px",
                    textAlign: "left",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  title={c.name}
                >
                  📁 {c.name}
                </button>
                <span
                  style={{
                    fontSize: "11px",
                    color: mutedText,
                    marginRight: "6px",
                  }}
                >
                  {count}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCollection(c.id);
                    if (selectedCollectionId === c.id)
                      setSelectedCollectionId(undefined);
                  }}
                  title="Delete collection"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: mutedText,
                    cursor: "pointer",
                    fontSize: "11px",
                    padding: "2px",
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: mutedText,
                marginBottom: "8px",
                paddingLeft: "8px",
              }}
            >
              Tags
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                paddingLeft: "8px",
              }}
            >
              {allTags.map((t) => {
                const isSelected = selectedTag === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setSelectedTag(isSelected ? undefined : t);
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "12px",
                      fontSize: "11px",
                      border: `1px solid ${isSelected ? accentColor : borderColor}`,
                      backgroundColor: isSelected ? accentColor : "transparent",
                      color: isSelected ? "#ffffff" : textColor,
                      cursor: "pointer",
                    }}
                  >
                    #{t}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Controls Toolbar */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: `1px solid ${borderColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            backgroundColor: sidebarBg,
          }}
        >
          {/* Search box */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flex: "1 1 300px",
              maxWidth: "500px",
            }}
          >
            <span style={{ fontSize: "14px", color: mutedText }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search books, authors, tags..."
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                backgroundColor: bg,
                color: textColor,
                fontSize: "13px",
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                style={{
                  background: "transparent",
                  border: "none",
                  color: mutedText,
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Actions & Sorting */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Sort Dropdown */}
            <select
              className="library-sort-select"
              aria-label="Sort publications"
              value={`${sortCriteria.field}-${sortCriteria.direction}`}
              onChange={(e) => {
                const [field, direction] = e.target.value.split("-") as [
                  BookSortCriteria["field"],
                  BookSortCriteria["direction"],
                ];
                setSortCriteria({ field, direction });
              }}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                backgroundColor: bg,
                color: textColor,
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="dateAdded-desc">Recently Added</option>
              <option value="dateAdded-asc">Oldest Added</option>
              <option value="title-asc">Title (A-Z)</option>
              <option value="title-desc">Title (Z-A)</option>
              <option value="creator-asc">Author (A-Z)</option>
              <option value="lastOpened-desc">Recently Read</option>
            </select>

            {/* View Mode Toggle */}
            <div
              style={{
                display: "flex",
                border: `1px solid ${borderColor}`,
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid View"
                style={{
                  padding: "6px 10px",
                  border: "none",
                  backgroundColor:
                    viewMode === "grid"
                      ? isDark
                        ? "#333333"
                        : "#e5e7eb"
                      : "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                田
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="List View"
                style={{
                  padding: "6px 10px",
                  border: "none",
                  backgroundColor:
                    viewMode === "list"
                      ? isDark
                        ? "#333333"
                        : "#e5e7eb"
                      : "transparent",
                  color: textColor,
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                ☰
              </button>
            </div>

            {/* Import Actions */}
            <button
              type="button"
              onClick={onAddFiles}
              style={{
                padding: "7px 12px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                backgroundColor: accentColor,
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>+</span>
              <span>Add Books</span>
            </button>

            <button
              type="button"
              onClick={onAddFolder}
              style={{
                padding: "7px 12px",
                borderRadius: "6px",
                border: `1px solid ${borderColor}`,
                backgroundColor: "transparent",
                color: textColor,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Add Folder...
            </button>
          </div>
        </div>

        {/* Catalog Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {catalog.books.length === 0 ? (
            <div
              className="empty-library-state"
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                gap: "16px",
                padding: "32px",
              }}
            >
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "16px",
                  backgroundColor: isDark ? "#2563eb" : "#dbeafe",
                  color: isDark ? "#ffffff" : "#1d4ed8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "32px",
                }}
              >
                📖
              </div>
              <h1
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "20px",
                  fontWeight: 700,
                  color: textColor,
                }}
              >
                ReflowPress Workbench
              </h1>
              <p
                style={{
                  margin: "0 0 16px 0",
                  maxWidth: "440px",
                  color: mutedText,
                  fontSize: "14px",
                  lineHeight: 1.5,
                }}
              >
                Open a local EPUB or PDF publication to start reading with
                reflowable typography, chapter navigation, and offline reading
                state.
              </p>
              <div
                style={{ display: "flex", gap: "12px", alignItems: "center" }}
              >
                <button
                  type="button"
                  onClick={onAddFiles}
                  style={{
                    padding: "10px 24px",
                    backgroundColor: "#2563eb",
                    color: "#ffffff",
                    fontSize: "14px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span>📂</span>
                  <span>Open Publication</span>
                </button>
                <button
                  type="button"
                  onClick={onAddFolder}
                  style={{
                    padding: "10px 18px",
                    backgroundColor: "transparent",
                    color: textColor,
                    border: `1px solid ${borderColor}`,
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>📁</span>
                  <span>Add Folder...</span>
                </button>
              </div>
              <div
                style={{
                  marginTop: "16px",
                  fontSize: "12px",
                  color: mutedText,
                }}
              >
                Supported formats: <strong>.epub</strong>, <strong>.pdf</strong>
              </div>
            </div>
          ) : displayBooks.length === 0 ? (
            <div
              style={{
                padding: "60px 0",
                textAlign: "center",
                color: mutedText,
              }}
            >
              <p style={{ fontSize: "16px", marginBottom: "12px" }}>
                No publications match your filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedFormat("all");
                  setSelectedCollectionId(undefined);
                  setSelectedTag(undefined);
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  border: `1px solid ${borderColor}`,
                  backgroundColor: "transparent",
                  color: textColor,
                  cursor: "pointer",
                }}
              >
                Reset Filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: "20px",
              }}
            >
              {displayBooks.map((book) => {
                const coverUri = covers[book.id];
                const formatColor =
                  book.format === "epub" ? "#2563eb" : "#dc2626";

                return (
                  <div
                    key={book.id}
                    className="book-card"
                    onClick={() => onOpenBook(book)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      backgroundColor: cardBg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: "8px",
                      overflow: "hidden",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      position: "relative",
                    }}
                  >
                    {/* Cover Thumbnail */}
                    <div
                      style={{
                        position: "relative",
                        aspectRatio: "2 / 3",
                        width: "100%",
                        backgroundColor: isDark ? "#1a1a1a" : "#e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {coverUri ? (
                        <img
                          src={coverUri}
                          alt={book.title}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            padding: "16px 12px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            background:
                              book.format === "epub"
                                ? "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)"
                                : "linear-gradient(135deg, #7f1d1d 0%, #ef4444 100%)",
                            color: "#ffffff",
                            boxSizing: "border-box",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              lineHeight: 1.3,
                              overflow: "hidden",
                              display: "-webkit-box",
                              WebkitLineClamp: 4,
                              WebkitBoxOrient: "vertical",
                            }}
                          >
                            {book.title}
                          </div>
                          <div
                            style={{
                              fontSize: "11px",
                              opacity: 0.85,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {book.creator || "Unknown Author"}
                          </div>
                        </div>
                      )}

                      {/* Format Badge */}
                      <span
                        style={{
                          position: "absolute",
                          top: "8px",
                          right: "8px",
                          fontSize: "10px",
                          fontWeight: 700,
                          backgroundColor: formatColor,
                          color: "#ffffff",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                        }}
                      >
                        {book.format}
                      </span>

                      {/* Availability status */}
                      {!book.availability.exists && (
                        <span
                          style={{
                            position: "absolute",
                            bottom: "8px",
                            left: "8px",
                            fontSize: "10px",
                            fontWeight: 600,
                            backgroundColor: "rgba(0,0,0,0.75)",
                            color: "#f87171",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          ⚠️ Missing file
                        </span>
                      )}
                    </div>

                    {/* Book Metadata */}
                    <div
                      style={{
                        padding: "10px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div
                        title={book.title}
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {book.title}
                      </div>
                      <div
                        title={book.creator || "Unknown Author"}
                        style={{
                          fontSize: "11px",
                          color: mutedText,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {book.creator || "Unknown Author"}
                      </div>
                    </div>

                    {/* Quick Menu / Remove */}
                    <div
                      style={{
                        padding: "4px 12px 8px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Collection Selector */}
                      {catalog.collections.length > 0 && (
                        <select
                          className="book-collection-select"
                          aria-label="Add to collection"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              const colId = e.target.value;
                              if (book.collectionIds.includes(colId)) {
                                onRemoveBookFromCollection(book.id, colId);
                              } else {
                                onAddBookToCollection(book.id, colId);
                              }
                            }
                          }}
                          style={{
                            fontSize: "10px",
                            padding: "2px 4px",
                            backgroundColor: "transparent",
                            color: mutedText,
                            border: `1px solid ${borderColor}`,
                            borderRadius: "4px",
                          }}
                        >
                          <option value="">+ Collection</option>
                          {catalog.collections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {book.collectionIds.includes(c.id)
                                ? `✓ ${c.name}`
                                : c.name}
                            </option>
                          ))}
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={() => onRemoveBook(book.id)}
                        title="Remove from Library"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: mutedText,
                          cursor: "pointer",
                          fontSize: "12px",
                          padding: "2px 4px",
                          marginLeft: "auto",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List View */
            <div
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 2fr 1.5fr 70px 100px 80px",
                  padding: "8px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: mutedText,
                  borderBottom: `1px solid ${borderColor}`,
                }}
              >
                <span></span>
                <span>Title</span>
                <span>Author</span>
                <span>Format</span>
                <span>Added</span>
                <span style={{ textAlign: "right" }}>Actions</span>
              </div>

              {displayBooks.map((book) => {
                const coverUri = covers[book.id];
                const formatColor =
                  book.format === "epub" ? "#2563eb" : "#dc2626";

                return (
                  <div
                    key={book.id}
                    onClick={() => onOpenBook(book)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 2fr 1.5fr 70px 100px 80px",
                      alignItems: "center",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      backgroundColor: cardBg,
                      border: `1px solid ${borderColor}`,
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {/* Small thumbnail */}
                    <div
                      style={{
                        width: "28px",
                        height: "38px",
                        borderRadius: "2px",
                        overflow: "hidden",
                        backgroundColor: isDark ? "#333333" : "#e5e7eb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {coverUri ? (
                        <img
                          src={coverUri}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            color: formatColor,
                          }}
                        >
                          {book.format[0]?.toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        paddingRight: "10px",
                      }}
                    >
                      {book.title}
                    </div>

                    <div
                      style={{
                        color: mutedText,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        paddingRight: "10px",
                      }}
                    >
                      {book.creator || "—"}
                    </div>

                    <div>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          backgroundColor: formatColor,
                          color: "#ffffff",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                        }}
                      >
                        {book.format}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: mutedText }}>
                      {new Date(book.dateAdded).toLocaleDateString()}
                    </div>

                    <div
                      style={{ textAlign: "right" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onRemoveBook(book.id)}
                        title="Remove book"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: mutedText,
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
