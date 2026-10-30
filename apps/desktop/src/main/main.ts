import { app, BrowserWindow, protocol, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc.js";
import { ReadingPositionStore } from "./reading-position-store.js";
import { JsonLibraryRepository } from "./library-repository.js";
import { JsonAnnotationRepository } from "./annotation-repository.js";
import {
  APP_ENTRY_URL,
  APP_SCHEME,
  isAppUrl,
} from "./security/app-protocol.js";
import { registerAppProtocolHandler } from "./security/app-protocol-handler.js";
import {
  hardenSession,
  hardenWebContents,
  hasOrigin,
} from "./security/session-hardening.js";
import { PathGrantRegistry } from "./security/path-grants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { CrashRecoveryManager } from "./crash-recovery.js";

let mainWindow: BrowserWindow | null = null;
let crashRecoveryManager: CrashRecoveryManager | null = null;

const devServerOrigin = process.env.VITE_DEV_SERVER_URL ?? null;

function isRendererUrl(url: string): boolean {
  return (
    isAppUrl(url) ||
    (devServerOrigin !== null && hasOrigin(url, devServerOrigin))
  );
}

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

app.on("web-contents-created", (_event, contents) => {
  hardenWebContents(contents, devServerOrigin);
});

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

async function createWindow(
  crashRecovery: CrashRecoveryManager,
): Promise<BrowserWindow> {
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
      webviewTag: false,
      // Chromium's spellchecker downloads dictionaries from Google on
      // Windows and Linux, which would break the no-network guarantee.
      spellcheck: false,
    },
  });
  // Popups, webviews and off-app navigation are refused for every
  // WebContents in the "web-contents-created" handler above.

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
  const pathGrants = new PathGrantRegistry();
  // The launch argument comes from the user (shell or file association),
  // not from the renderer, so it is readable without a dialog.
  if (initialFile) pathGrants.grantFile(initialFile, ["read"]);
  // The same holds for the publication recorded by crash recovery.
  const recoveredPath =
    crashRecovery.getRecoveryStatus()?.lastActiveSession?.lastActivePublication
      ?.filePath;
  if (recoveredPath) pathGrants.grantFile(recoveredPath, ["read"]);

  registerIpcHandlers(
    window,
    positionStore,
    libraryRepo,
    annotationRepo,
    coversDir,
    initialFile,
    crashRecovery,
    { pathGrants, isRendererUrl },
  );

  // Load renderer
  if (devServerOrigin !== null) {
    await window.loadURL(devServerOrigin);
  } else {
    await window.loadURL(APP_ENTRY_URL);
  }

  // Also notify via event if renderer is already listening
  if (initialFile) {
    window.webContents.send("app:open-initial-file", initialFile);
  }

  return window;
}

app.whenReady().then(async () => {
  hardenSession(session.defaultSession, devServerOrigin);
  registerAppProtocolHandler(protocol, path.resolve(__dirname, "../renderer"));

  crashRecoveryManager = new CrashRecoveryManager(app.getPath("userData"));
  await crashRecoveryManager.checkCrashAndInitialize();

  mainWindow = await createWindow(crashRecoveryManager);

  app.on("activate", async () => {
    if ((!mainWindow || mainWindow.isDestroyed()) && crashRecoveryManager) {
      mainWindow = await createWindow(crashRecoveryManager);
    }
  });
});

app.on("before-quit", async () => {
  if (crashRecoveryManager) {
    await crashRecoveryManager.recordCleanShutdown();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
