import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const fixturesDir = path.resolve(rootDir, "tests/fixtures");
const samplePdfPath = path.resolve(rootDir, "tests/fixtures/sample.pdf");
const mainEntry = path.resolve(rootDir, "apps/desktop/dist/main/main.js");

type Bridge = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Calls a bridge method from the renderer and reports how it settled. */
async function callBridge(
  page: Page,
  method: string,
  ...args: unknown[]
): Promise<{ ok: boolean; message: string }> {
  return page.evaluate(
    async ({ method, args }) => {
      const bridge = (window as unknown as { reflowPressDesktop: Bridge })
        .reflowPressDesktop;
      try {
        await bridge[method]!(...args);
        return { ok: true, message: "" };
      } catch (err) {
        return { ok: false, message: String(err) };
      }
    },
    { method, args },
  );
}

test.describe("ReflowPress desktop security boundary", () => {
  let app: ElectronApplication | null = null;
  let userDataDir = "";
  let outsideDir = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-sec-e2e-"));
    outsideDir = await mkdtemp(path.join(tmpdir(), "reflowpress-sec-out-"));
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    for (const dir of [userDataDir, outsideDir]) {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("serves the renderer from app:// and refuses paths the user never chose", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("app://reflowpress/index.html");

    // A compromised renderer must not be able to read or write arbitrary
    // locations through the bridge.
    const denied = [
      await callBridge(page, "readPdfBytes", samplePdfPath),
      await callBridge(page, "scanLibraryPaths", [fixturesDir]),
      await callBridge(page, "previewRestore", samplePdfPath),
      await callBridge(
        page,
        "createBackup",
        path.join(outsideDir, "startup.bat"),
      ),
      await callBridge(page, "syncFolder", outsideDir, { dryRun: false }),
      await callBridge(page, "transferToDevice", outsideDir, []),
      await callBridge(page, "readCoverImage", samplePdfPath),
    ];
    for (const result of denied.slice(0, -1)) {
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Access denied");
    }
    // Cover reads fail closed with null rather than an error.
    expect(denied.at(-1)!.ok).toBe(true);

    // Nothing was written outside the chosen locations.
    await expect(
      access(path.join(outsideDir, "startup.bat")),
    ).rejects.toThrow();
    await expect(
      access(path.join(outsideDir, "reflowpress-sync")),
    ).rejects.toThrow();
  });

  test("allows a path once the user picks it in the native dialog", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await app.evaluate(({ dialog }, pdf) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [pdf],
      })) as typeof dialog.showOpenDialog;
    }, samplePdfPath);

    const picked = await page.evaluate(() =>
      (
        window as unknown as {
          reflowPressDesktop: { openFileDialog: () => Promise<string | null> };
        }
      ).reflowPressDesktop.openFileDialog(),
    );
    expect(picked).toBe(samplePdfPath);
    expect((await callBridge(page, "readPdfBytes", samplePdfPath)).ok).toBe(
      true,
    );
  });
});
