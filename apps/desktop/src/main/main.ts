import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";
import { ReadingPositionStore } from "./reading-position-store.js";
import { JsonLibraryRepository } from "./library-repository.js";
import { JsonAnnotationRepository } from "./annotation-repository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function parseInitialFileArgument(): string | null {
  const args = process.argv;
  const openEqual = args.find((a) => a.startsWith("--open="));
  if (openEqual) {
    return path.resolve(openEqual.slice(7));
  }
  const openIndex = args.indexOf("--open");
  if (openIndex !== -1 && args[openIndex + 1]) {
    return path.resolve(args[openIndex + 1]!);
  }
  return null;
}

async function createWindow(): Promise<BrowserWindow> {
  const preloadPath = path.resolve(__dirname, "../preload/preload.cjs");

  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: "ReflowPress Workbench",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Strict security: prevent new windows and unauthorized external navigation
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    // Only allow navigating to app bundle file:// URLs or Vite dev server
    const parsed = new URL(navigationUrl);
    if (
      parsed.protocol !== "file:" &&
      !navigationUrl.startsWith("http://localhost:5173")
    ) {
      event.preventDefault();
    }
  });

  const positionStorePath = path.join(
    app.getPath("userData"),
    "reader-state.json",
  );
  const positionStore = new ReadingPositionStore(positionStorePath);

  const libraryStorePath = path.join(
    app.getPath("userData"),
    "library-v1.json",
  );
  const libraryRepo = new JsonLibraryRepository(libraryStorePath);

  const annotationStorePath = path.join(
    app.getPath("userData"),
    "annotations-v1.json",
  );
  const annotationRepo = new JsonAnnotationRepository(annotationStorePath);

  const coversDir = path.join(
    app.getPath("userData"),
    "library-cache",
    "covers",
  );

  const initialFile = parseInitialFileArgument();
  registerIpcHandlers(
    window,
    positionStore,
    libraryRepo,
    annotationRepo,
    coversDir,
    initialFile,
  );

  // Load renderer
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    const indexPath = path.resolve(__dirname, "../renderer/index.html");
    await window.loadFile(indexPath);
  }

  // Also notify via event if renderer is already listening
  if (initialFile) {
    window.webContents.send("app:open-initial-file", initialFile);
  }

  return window;
}

app.whenReady().then(async () => {
  mainWindow = await createWindow();

  app.on("activate", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
