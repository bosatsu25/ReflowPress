import React, { useState, useId } from "react";
import type {
  AnnotationColor,
  AnnotationStore,
  BookmarkAnnotation,
  HighlightAnnotation,
  NoteAnnotation,
  PublicationLocator,
} from "@reflowpress/annotations";
import {
  createBookmark,
  deleteBookmark,
  deleteHighlight,
  updateHighlightColor,
  createNote,
  updateNoteBody,
  deleteNote,
} from "@reflowpress/annotations";
import type { SearchProgress, SearchResult } from "@reflowpress/search";

export interface ReadingToolsDrawerProps {
  isOpen: boolean;
  activeTab: "search" | "bookmarks" | "highlights" | "notes";
  onTabChange: (tab: "search" | "bookmarks" | "highlights" | "notes") => void;
  onClose: () => void;
  theme: "light" | "sepia" | "dark";
  publicationId: string;
  publicationTitle: string;
  publicationFormat: "epub" | "pdf";
  store: AnnotationStore;
  onSaveStore: (newStore: AnnotationStore) => Promise<void>;
  currentLocator: PublicationLocator;
  onJumpToLocator: (locator: PublicationLocator) => void;
  searchResults: SearchResult[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isSearching: boolean;
  searchProgress?: SearchProgress | undefined;
  onExport: (format: "json" | "markdown" | "html") => Promise<void>;
  onImport: () => Promise<void>;
}

export const ReadingToolsDrawer: React.FC<ReadingToolsDrawerProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  theme,
  publicationId,
  store,
  onSaveStore,
  currentLocator,
  onJumpToLocator,
  searchResults,
  searchQuery,
  onSearchQueryChange,
  isSearching,
  searchProgress,
  onExport,
  onImport,
}) => {
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const [newNoteBody, setNewNoteBody] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const searchInputId = useId();

  if (!isOpen) return null;

  const isDark = theme === "dark";
  const isSepia = theme === "sepia";

  const bg = isDark ? "#1e1e1e" : isSepia ? "#f4ebd0" : "#ffffff";
  const text = isDark ? "#f3f4f6" : isSepia ? "#3c3226" : "#1f2937";
  const border = isDark ? "#333333" : isSepia ? "#e2d2b5" : "#e5e7eb";
  const itemHover = isDark ? "#2a2a2a" : isSepia ? "#ece0c4" : "#f3f4f6";

  const pubAnnotations = store.annotations.filter(
    (a) => a.publicationId === publicationId,
  );
  const bookmarks = pubAnnotations.filter(
    (a): a is BookmarkAnnotation => a.kind === "bookmark",
  );
  const highlights = pubAnnotations.filter(
    (a): a is HighlightAnnotation => a.kind === "highlight",
  );
  const notes = pubAnnotations.filter(
    (a): a is NoteAnnotation => a.kind === "note",
  );

  const handleAddBookmark = async () => {
    const { store: updated, bookmark } = createBookmark(store, {
      publicationId,
      locator: currentLocator,
      label: bookmarkLabel.trim() || undefined,
    });
    setBookmarkLabel("");
    await onSaveStore(updated);
    return bookmark;
  };

  const handleDeleteBookmark = async (id: string) => {
    const updated = deleteBookmark(store, id);
    await onSaveStore(updated);
  };

  const handleDeleteHighlight = async (id: string) => {
    const updated = deleteHighlight(store, id);
    await onSaveStore(updated);
  };

  const handleColorChange = async (id: string, color: AnnotationColor) => {
    const updated = updateHighlightColor(store, id, color);
    await onSaveStore(updated);
  };

  const handleAddStandaloneNote = async () => {
    if (!newNoteBody.trim()) return;
    const { store: updated } = createNote(store, {
      publicationId,
      locator: currentLocator,
      body: newNoteBody.trim(),
    });
    setNewNoteBody("");
    await onSaveStore(updated);
  };

  const handleSaveEditNote = async (id: string) => {
    if (!editingNoteBody.trim()) return;
    const updated = updateNoteBody(store, id, editingNoteBody.trim());
    setEditingNoteId(null);
    await onSaveStore(updated);
  };

  const handleDeleteNote = async (id: string) => {
    const updated = deleteNote(store, id);
    await onSaveStore(updated);
  };

  const handleTriggerExport = async (format: "json" | "markdown" | "html") => {
    try {
      setExportMessage("Exporting...");
      await onExport(format);
      setExportMessage(`Export to ${format.toUpperCase()} complete!`);
      setTimeout(() => setExportMessage(null), 3000);
    } catch (err) {
      setExportMessage(`Export failed: ${String(err)}`);
      setTimeout(() => setExportMessage(null), 4000);
    }
  };

  const handleTriggerImport = async () => {
    try {
      setExportMessage("Importing...");
      await onImport();
      setExportMessage("Import finished!");
      setTimeout(() => setExportMessage(null), 3000);
    } catch (err) {
      setExportMessage(`Import failed: ${String(err)}`);
      setTimeout(() => setExportMessage(null), 4000);
    }
  };

  return (
    <aside
      className="reading-tools-drawer"
      aria-label="Reading Tools"
      style={{
        position: "fixed",
        top: "48px",
        right: 0,
        bottom: 0,
        width: "360px",
        maxWidth: "90vw",
        backgroundColor: bg,
        color: text,
        borderLeft: `1px solid ${border}`,
        boxShadow: "-4px 0 16px rgba(0,0,0,0.15)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Drawer Header with Tabs */}
      <div
        style={{
          borderBottom: `1px solid ${border}`,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: "4px" }}>
          {(
            [
              { key: "search", label: "🔍 Search" },
              { key: "bookmarks", label: `🔖 (${bookmarks.length})` },
              { key: "highlights", label: `🖍 (${highlights.length})` },
              { key: "notes", label: `📝 (${notes.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              style={{
                padding: "6px 8px",
                border: "none",
                borderRadius: "4px",
                backgroundColor:
                  activeTab === tab.key
                    ? isDark
                      ? "#374151"
                      : "#e5e7eb"
                    : "transparent",
                color: text,
                cursor: "pointer",
                fontWeight: activeTab === tab.key ? 600 : 400,
                fontSize: "12px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Reading Tools"
          style={{
            border: "none",
            background: "transparent",
            color: text,
            cursor: "pointer",
            fontSize: "16px",
            padding: "4px 8px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Drawer Tab Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px" }}>
        {/* ================= SEARCH TAB ================= */}
        {activeTab === "search" && (
          <div className="tab-pane-search">
            <div style={{ marginBottom: "12px" }}>
              <label
                htmlFor={searchInputId}
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "4px",
                }}
              >
                In-Book Full-Text Search
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  id={searchInputId}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder="Search in this publication..."
                  autoFocus
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: "4px",
                    border: `1px solid ${border}`,
                    backgroundColor: isDark ? "#2a2a2a" : "#ffffff",
                    color: text,
                    fontSize: "13px",
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchQueryChange("")}
                    title="Clear query"
                    style={{
                      padding: "4px 8px",
                      border: `1px solid ${border}`,
                      borderRadius: "4px",
                      background: "transparent",
                      color: text,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {isSearching && (
              <div
                style={{
                  fontSize: "12px",
                  color: isDark ? "#9ca3af" : "#6b7280",
                  marginBottom: "8px",
                }}
              >
                Searching...{" "}
                {searchProgress
                  ? `${searchProgress.current}/${searchProgress.total}`
                  : ""}
              </div>
            )}

            {!isSearching && searchQuery.trim() && (
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "10px",
                  color: isDark ? "#9ca3af" : "#6b7280",
                }}
              >
                {searchResults.length} match
                {searchResults.length === 1 ? "" : "es"} found
              </div>
            )}

            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {searchResults.map((res) => (
                <div
                  key={res.id}
                  onClick={() => onJumpToLocator(res.locator)}
                  style={{
                    padding: "10px",
                    borderRadius: "6px",
                    border: `1px solid ${border}`,
                    cursor: "pointer",
                    backgroundColor: isDark ? "#252525" : "#fafafa",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = itemHover)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "#252525"
                      : "#fafafa")
                  }
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: isDark ? "#60a5fa" : "#2563eb",
                      marginBottom: "4px",
                    }}
                  >
                    {res.page
                      ? `Page ${res.page}`
                      : res.sectionTitle || res.sectionHref}
                  </div>
                  <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
                    <span>{res.snippet.before}</span>
                    <mark
                      style={{
                        backgroundColor: "#fef08a",
                        color: "#000",
                        padding: "1px 3px",
                        borderRadius: "2px",
                        fontWeight: 600,
                      }}
                    >
                      {res.snippet.match}
                    </mark>
                    <span>{res.snippet.after}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= BOOKMARKS TAB ================= */}
        {activeTab === "bookmarks" && (
          <div className="tab-pane-bookmarks">
            <div
              style={{
                marginBottom: "14px",
                padding: "10px",
                border: `1px solid ${border}`,
                borderRadius: "6px",
                backgroundColor: isDark ? "#262626" : "#f9fafb",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Bookmark Current Location
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  value={bookmarkLabel}
                  onChange={(e) => setBookmarkLabel(e.target.value)}
                  placeholder="Optional bookmark note..."
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: "4px",
                    border: `1px solid ${border}`,
                    backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
                    color: text,
                    fontSize: "12px",
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddBookmark}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: isDark ? "#2563eb" : "#3b82f6",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            {bookmarks.length === 0 ? (
              <div
                style={{
                  color: isDark ? "#9ca3af" : "#6b7280",
                  fontSize: "13px",
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                No bookmarks in this book yet.
              </div>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {bookmarks.map((b) => (
                  <div
                    key={b.id}
                    style={{
                      padding: "10px",
                      borderRadius: "6px",
                      border: `1px solid ${border}`,
                      backgroundColor: isDark ? "#252525" : "#fafafa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ cursor: "pointer", flex: 1, minWidth: 0 }}
                      onClick={() => onJumpToLocator(b.locator)}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: isDark ? "#60a5fa" : "#2563eb",
                        }}
                      >
                        {b.locator.kind === "pdf"
                          ? `Page ${b.locator.page}`
                          : `Section ${b.locator.sectionHref}`}
                      </div>
                      {b.label && (
                        <div
                          style={{
                            fontSize: "13px",
                            marginTop: "2px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {b.label}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: "10px",
                          color: isDark ? "#6b7280" : "#9ca3af",
                          marginTop: "2px",
                        }}
                      >
                        {new Date(b.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteBookmark(b.id)}
                      title="Delete bookmark"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#ef4444",
                        cursor: "pointer",
                        padding: "4px 8px",
                        fontSize: "13px",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= HIGHLIGHTS TAB ================= */}
        {activeTab === "highlights" && (
          <div className="tab-pane-highlights">
            {highlights.length === 0 ? (
              <div
                style={{
                  color: isDark ? "#9ca3af" : "#6b7280",
                  fontSize: "13px",
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                No highlights yet. Select text in the book to create highlights!
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {highlights.map((h) => {
                  const colorMap = {
                    yellow: "#fef08a",
                    green: "#bbf7d0",
                    blue: "#bfdbfe",
                    pink: "#fbcfe8",
                  };
                  return (
                    <div
                      key={h.id}
                      style={{
                        padding: "10px",
                        borderRadius: "6px",
                        border: `1px solid ${border}`,
                        borderLeft: `4px solid ${colorMap[h.color]}`,
                        backgroundColor: isDark ? "#252525" : "#fafafa",
                      }}
                    >
                      <div
                        style={{ cursor: "pointer", marginBottom: "6px" }}
                        onClick={() => onJumpToLocator(h.locator)}
                      >
                        <blockquote
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            fontStyle: "italic",
                            lineHeight: "1.4",
                          }}
                        >
                          &ldquo;{h.textQuote.exact}&rdquo;
                        </blockquote>
                        <div
                          style={{
                            fontSize: "11px",
                            color: isDark ? "#9ca3af" : "#6b7280",
                            marginTop: "4px",
                          }}
                        >
                          {h.locator.kind === "pdf"
                            ? `Page ${h.locator.page}`
                            : `Section ${h.locator.sectionHref}`}
                        </div>
                      </div>

                      {/* Highlight color picker and delete */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: "6px",
                          borderTop: `1px solid ${border}`,
                          paddingTop: "6px",
                        }}
                      >
                        <div style={{ display: "flex", gap: "4px" }}>
                          {(["yellow", "green", "blue", "pink"] as const).map(
                            (c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => handleColorChange(h.id, c)}
                                title={`Change color to ${c}`}
                                style={{
                                  width: "14px",
                                  height: "14px",
                                  borderRadius: "50%",
                                  backgroundColor: colorMap[c],
                                  border:
                                    h.color === c
                                      ? "2px solid #000"
                                      : "1px solid rgba(0,0,0,0.2)",
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              />
                            ),
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteHighlight(h.id)}
                          title="Delete highlight"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "11px",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= NOTES TAB ================= */}
        {activeTab === "notes" && (
          <div className="tab-pane-notes">
            <div
              style={{
                marginBottom: "14px",
                padding: "10px",
                border: `1px solid ${border}`,
                borderRadius: "6px",
                backgroundColor: isDark ? "#262626" : "#f9fafb",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "4px",
                }}
              >
                + Add Note at Current Position
              </div>
              <textarea
                value={newNoteBody}
                onChange={(e) => setNewNoteBody(e.target.value)}
                placeholder="Type your notes or thoughts..."
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  border: `1px solid ${border}`,
                  backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
                  color: text,
                  fontSize: "12px",
                  fontFamily: "inherit",
                  resize: "vertical",
                  marginBottom: "6px",
                }}
              />
              <button
                type="button"
                onClick={handleAddStandaloneNote}
                disabled={!newNoteBody.trim()}
                style={{
                  padding: "6px 12px",
                  backgroundColor: isDark ? "#2563eb" : "#3b82f6",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: newNoteBody.trim() ? "pointer" : "default",
                  opacity: newNoteBody.trim() ? 1 : 0.5,
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                Save Note
              </button>
            </div>

            {notes.length === 0 ? (
              <div
                style={{
                  color: isDark ? "#9ca3af" : "#6b7280",
                  fontSize: "13px",
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                No notes in this book yet.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {notes.map((n) => {
                  const linkedHighlight = highlights.find(
                    (h) => h.id === n.highlightId || h.noteId === n.id,
                  );
                  const isEditing = editingNoteId === n.id;

                  return (
                    <div
                      key={n.id}
                      style={{
                        padding: "10px",
                        borderRadius: "6px",
                        border: `1px solid ${border}`,
                        backgroundColor: isDark ? "#252525" : "#fafafa",
                      }}
                    >
                      {linkedHighlight && (
                        <blockquote
                          style={{
                            margin: "0 0 6px 0",
                            fontSize: "11px",
                            fontStyle: "italic",
                            color: isDark ? "#9ca3af" : "#6b7280",
                            borderLeft: "2px solid #94a3b8",
                            paddingLeft: "6px",
                          }}
                        >
                          &ldquo;{linkedHighlight.textQuote.exact}&rdquo;
                        </blockquote>
                      )}

                      {isEditing ? (
                        <div>
                          <textarea
                            value={editingNoteBody}
                            onChange={(e) => setEditingNoteBody(e.target.value)}
                            rows={3}
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              padding: "6px",
                              borderRadius: "4px",
                              border: `1px solid ${border}`,
                              backgroundColor: isDark ? "#1e1e1e" : "#ffffff",
                              color: text,
                              fontSize: "12px",
                              fontFamily: "inherit",
                              marginBottom: "6px",
                            }}
                          />
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveEditNote(n.id)}
                              style={{
                                padding: "4px 8px",
                                backgroundColor: isDark ? "#2563eb" : "#3b82f6",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontSize: "11px",
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNoteId(null)}
                              style={{
                                padding: "4px 8px",
                                background: "transparent",
                                border: `1px solid ${border}`,
                                color: text,
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontSize: "11px",
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: "13px",
                            lineHeight: "1.4",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {n.body}
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: "8px",
                          borderTop: `1px solid ${border}`,
                          paddingTop: "6px",
                          fontSize: "11px",
                          color: isDark ? "#9ca3af" : "#6b7280",
                        }}
                      >
                        <span
                          style={{ cursor: "pointer" }}
                          onClick={() => onJumpToLocator(n.locator)}
                        >
                          {n.locator.kind === "pdf"
                            ? `Page ${n.locator.page}`
                            : `Section ${n.locator.sectionHref}`}
                        </span>

                        {!isEditing && (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteId(n.id);
                                setEditingNoteBody(n.body);
                              }}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: isDark ? "#60a5fa" : "#2563eb",
                                cursor: "pointer",
                                fontSize: "11px",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(n.id)}
                              style={{
                                border: "none",
                                background: "transparent",
                                color: "#ef4444",
                                cursor: "pointer",
                                fontSize: "11px",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drawer Footer: Export & Import Actions */}
      <div
        style={{
          borderTop: `1px solid ${border}`,
          padding: "10px 14px",
          backgroundColor: isDark ? "#1a1a1a" : "#f9fafb",
        }}
      >
        {exportMessage && (
          <div
            style={{
              fontSize: "11px",
              color: isDark ? "#34d399" : "#059669",
              marginBottom: "6px",
              fontWeight: 600,
            }}
          >
            {exportMessage}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: "4px" }}>
            <span
              style={{
                fontSize: "11px",
                color: isDark ? "#9ca3af" : "#6b7280",
                alignSelf: "center",
                marginRight: "2px",
              }}
            >
              Export:
            </span>
            <button
              type="button"
              onClick={() => handleTriggerExport("markdown")}
              title="Export annotations to Markdown file"
              style={{
                padding: "3px 6px",
                fontSize: "11px",
                border: `1px solid ${border}`,
                borderRadius: "3px",
                background: "transparent",
                color: text,
                cursor: "pointer",
              }}
            >
              MD
            </button>
            <button
              type="button"
              onClick={() => handleTriggerExport("html")}
              title="Export annotations to standalone HTML"
              style={{
                padding: "3px 6px",
                fontSize: "11px",
                border: `1px solid ${border}`,
                borderRadius: "3px",
                background: "transparent",
                color: text,
                cursor: "pointer",
              }}
            >
              HTML
            </button>
            <button
              type="button"
              onClick={() => handleTriggerExport("json")}
              title="Export portable annotations JSON"
              style={{
                padding: "3px 6px",
                fontSize: "11px",
                border: `1px solid ${border}`,
                borderRadius: "3px",
                background: "transparent",
                color: text,
                cursor: "pointer",
              }}
            >
              JSON
            </button>
          </div>
          <button
            type="button"
            onClick={handleTriggerImport}
            title="Import annotations from JSON file"
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              border: `1px solid ${border}`,
              borderRadius: "4px",
              background: isDark ? "#374151" : "#e5e7eb",
              color: text,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            📥 Import JSON
          </button>
        </div>
      </div>
    </aside>
  );
};
