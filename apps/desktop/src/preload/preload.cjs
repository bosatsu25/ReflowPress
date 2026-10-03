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
  // Annotations API
  loadAnnotations() {
    return ipcRenderer.invoke("annotations:load");
  },
  saveAnnotations(store) {
    return ipcRenderer.invoke("annotations:save", store);
  },
  exportAnnotations(publication, format, targetPath, publicationId) {
    return ipcRenderer.invoke(
      "annotations:export",
      publication,
      format,
      targetPath,
      publicationId,
    );
  },
  importAnnotations(sourcePath, targetPublicationId) {
    return ipcRenderer.invoke(
      "annotations:import",
      sourcePath,
      targetPublicationId,
    );
  },
  showSaveFileDialog(options) {
    return ipcRenderer.invoke("dialog:save-file", options);
  },
  showOpenAnnotationFileDialog() {
    return ipcRenderer.invoke("dialog:open-annotation-file");
  },
  inspectPublication(filePath) {
    return ipcRenderer.invoke("publication:inspect", filePath);
  },
  repairPublication(filePath, options) {
    return ipcRenderer.invoke("publication:repair", filePath, options);
  },
  // Interoperability API
  opdsStart(options) {
    return ipcRenderer.invoke("opds:start", options);
  },
  opdsStop() {
    return ipcRenderer.invoke("opds:stop");
  },
  opdsGetStatus() {
    return ipcRenderer.invoke("opds:status");
  },
  syncFolder(targetDir, options) {
    return ipcRenderer.invoke("sync:folder", targetDir, options);
  },
  syncWebdav(url, username, password, options) {
    return ipcRenderer.invoke("sync:webdav", url, username, password, options);
  },
  createBackup(outputPath) {
    return ipcRenderer.invoke("backup:create", outputPath);
  },
  previewRestore(bundlePath) {
    return ipcRenderer.invoke("restore:preview", bundlePath);
  },
  applyRestore(bundlePath, policy) {
    return ipcRenderer.invoke("restore:apply", bundlePath, policy);
  },
  discoverDevices(targetDir) {
    return ipcRenderer.invoke("device:discover", targetDir);
  },
  transferToDevice(targetMount, bookIds) {
    return ipcRenderer.invoke("device:transfer", targetMount, bookIds);
  },
};

contextBridge.exposeInMainWorld("reflowPressDesktop", bridge);
