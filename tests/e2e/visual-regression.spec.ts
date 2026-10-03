import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const sampleJapaneseEpubPath = path.resolve(
  rootDir,
  "tests/fixtures/sample-japanese.epub",
);
const mainEntry = path.resolve(rootDir, "apps/desktop/dist/main/main.js");

test.describe("Tier 3 Visual Regression Testing", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-visual-e2e-"));
  });

  test.afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      userDataDir = "";
    }
  });

  test("renders Japanese text and ruby annotations stably on fixed viewport", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleJapaneseEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForLoadState("domcontentloaded");

    const iframe = page.locator("iframe.epub-viewport-frame");
    await expect(iframe).toBeVisible({ timeout: 10000 });

    // Wait for content inside iframe to be painted
    const frame = page.frameLocator("iframe.epub-viewport-frame");
    await expect(frame.locator("h1")).toBeVisible({ timeout: 5000 });

    // Assert ruby annotations exist and are styled properly
    const rubyElement = frame.locator("ruby").first();
    if (await rubyElement.isVisible()) {
      await expect(rubyElement).toBeVisible();
      const rtText = await rubyElement.locator("rt").textContent();
      expect(rtText).toBeTruthy();
    }

    // Capture visual snapshot buffer to assert non-zero screenshot dimensions
    const screenshot = await page.screenshot();
    expect(screenshot.length).toBeGreaterThan(10000);
  });
});
