/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  openFileDialog() {
    return ipcRenderer.invoke("dialog:open-file");
  },
  openMultipleFilesDialog() {
    return ipcRenderer.invoke("dialog:open-multiple-files");
  },
  openDirectoryDialog() {
    return ipcRenderer.invoke("dialog:open-directory");
  },
  loadPublication(filePath) {
    return ipcRenderer.invoke("publication:load", filePath);
  },
  async readPdfBytes(filePath) {
    const bytes = await ipcRenderer.invoke("publication:read-pdf", filePath);
    return new Uint8Array(bytes);
  },
  loadReadingPosition(publicationId) {
    return ipcRenderer.invoke("position:get", publicationId);
  },
  saveReadingPosition(position) {
    return ipcRenderer.invoke("position:set", position);
  },
  getInitialFile() {
    return ipcRenderer.invoke("app:get-initial-file");
  },
  onOpenInitialFile(callback) {
    const handler = (_event, path) => callback(path);
    ipcRenderer.on("app:open-initial-file", handler);
    return () => {
      ipcRenderer.removeListener("app:open-initial-file", handler);
    };
  },
  // Library API
  loadLibrary() {
    return ipcRenderer.invoke("library:load");
  },
  saveLibrary(catalog) {
    return ipcRenderer.invoke("library:save", catalog);
  },
  scanLibraryPaths(paths) {
    return ipcRenderer.invoke("library:scan-paths", paths);
  },
  removeBookFromLibrary(bookId) {
    return ipcRenderer.invoke("library:remove-book", bookId);
  },
  updateBookInLibrary(bookId, updates) {
    return ipcRenderer.invoke("library:update-book", bookId, updates);
  },
  createLibraryCollection(name, description) {
    return ipcRenderer.invoke("library:create-collection", name, description);
  },
  deleteLibraryCollection(collectionId) {
    return ipcRenderer.invoke("library:delete-collection", collectionId);
  },
  addBookToLibraryCollection(bookId, collectionId) {
    return ipcRenderer.invoke(
      "library:add-book-to-collection",
      bookId,
      collectionId,
    );
  },
  removeBookFromLibraryCollection(bookId, collectionId) {
    return ipcRenderer.invoke(
      "library:remove-book-from-collection",
      bookId,
      collectionId,
    );
  },
  readCoverImage(coverPath) {
    return ipcRenderer.invoke("library:read-cover", coverPath);
  },
};

contextBridge.exposeInMainWorld("reflowPressDesktop", bridge);
