/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  openFileDialog() {
    return ipcRenderer.invoke("dialog:open-file");
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
};

contextBridge.exposeInMainWorld("reflowPressDesktop", bridge);
