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

const fixturesDir = path.resolve(rootDir, "tests/fixtures");
const sampleEpubPath = path.resolve(rootDir, "tests/fixtures/sample.epub");
const samplePdfPath = path.resolve(rootDir, "tests/fixtures/sample.pdf");
const mainEntry = path.resolve(rootDir, "apps/desktop/dist/main/main.js");

test.describe("ReflowPress Library MVP Desktop E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-lib-e2e-"));
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

  test("1. launches workbench and displays library interface with empty state", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveTitle(/ReflowPress/);

    // Empty state heading and actions
    await expect(page.locator("h1")).toHaveText("ReflowPress Workbench");
    await expect(
      page.locator("button:has-text('Open Publication')"),
    ).toBeVisible();
    await expect(
      page.locator(".empty-library-state button:has-text('Add Folder')"),
    ).toBeVisible();
    await expect(page.locator("button:has-text('Open...')")).toBeVisible();
  });

  test("2. scans directory and populates catalog with EPUB and PDF cards", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Scan fixtures folder via desktop bridge
    await page.evaluate(async (dir) => {
      const bridge = (
        window as unknown as {
          reflowPressDesktop: {
            scanLibraryPaths: (paths: string[]) => Promise<unknown>;
            loadLibrary: () => Promise<unknown>;
          };
        }
      ).reflowPressDesktop;
      await bridge.scanLibraryPaths([dir]);
      // Trigger reload to update UI state if needed
      await bridge.loadLibrary();
    }, fixturesDir);

    // Reload window to reflect indexed catalog in view
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Book cards should now be rendered
    const cards = page.locator(".book-card");
    await expect(cards).toHaveCount(2);

    // Format badges
    await expect(page.locator("span:has-text('EPUB')").first()).toBeVisible();
    await expect(page.locator("span:has-text('PDF')").first()).toBeVisible();
  });

  test("3. filters catalog by query and format category", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Index sample books
    await page.evaluate(
      async ({ epub, pdf }) => {
        const bridge = (
          window as unknown as {
            reflowPressDesktop: {
              scanLibraryPaths: (paths: string[]) => Promise<unknown>;
            };
          }
        ).reflowPressDesktop;
        await bridge.scanLibraryPaths([epub, pdf]);
      },
      { epub: sampleEpubPath, pdf: samplePdfPath },
    );

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Filter by format: click PDF category in sidebar
    await page.locator("button:has-text('PDF')").click();
    await expect(page.locator(".book-card")).toHaveCount(1);
    await expect(page.locator(".book-card span:has-text('PDF')")).toBeVisible();

    // Filter by format: click EPUB category
    await page.locator("button:has-text('EPUB')").click();
    await expect(page.locator(".book-card")).toHaveCount(1);
    await expect(
      page.locator(".book-card span:has-text('EPUB')"),
    ).toBeVisible();

    // Return to All Books
    await page.locator("button:has-text('All Books')").click();
    await expect(page.locator(".book-card")).toHaveCount(2);

    // Search by title
    const searchInput = page.locator("input[placeholder*='Search']");
    await searchInput.fill("sample");
    await expect(page.locator(".book-card")).toHaveCount(2);

    await searchInput.fill("nonexistent-book-title-xyz");
    await expect(
      page.locator("text=No publications match your filter"),
    ).toBeVisible();
  });

  test("4. creates collection and assigns book to collection", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Index books
    await page.evaluate(async (epub) => {
      const bridge = (
        window as unknown as {
          reflowPressDesktop: {
            scanLibraryPaths: (paths: string[]) => Promise<unknown>;
          };
        }
      ).reflowPressDesktop;
      await bridge.scanLibraryPaths([epub]);
    }, sampleEpubPath);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Click "+" to create collection
    await page.locator("button[title='Add Collection']").click();
    const collectionInput = page.locator("input[placeholder*='Collection']");
    await collectionInput.fill("Classics");
    await page.locator("button:has-text('Save')").click();

    // Verify collection appears in sidebar
    await expect(page.locator("button:has-text('Classics')")).toBeVisible();

    // Assign book to collection via select dropdown
    const select = page.locator(".book-collection-select").first();
    await select.selectOption({ label: "Classics" });

    // Filter by collection
    await page.locator("button:has-text('Classics')").click();
    await expect(page.locator(".book-card")).toHaveCount(1);
  });

  test("5. activates reader from library card and returns to library via Back button", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Index sample EPUB
    await page.evaluate(async (epub) => {
      const bridge = (
        window as unknown as {
          reflowPressDesktop: {
            scanLibraryPaths: (paths: string[]) => Promise<unknown>;
          };
        }
      ).reflowPressDesktop;
      await bridge.scanLibraryPaths([epub]);
    }, sampleEpubPath);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Click on book card to open reader
    await page.locator(".book-card").first().click();

    // Wait for reader to mount
    const iframe = page.locator("iframe.epub-viewport-frame");
    await expect(iframe).toBeVisible();

    // Header must have "← Library" button
    const backBtn = page.locator("button:has-text('Library')");
    await expect(backBtn).toBeVisible();

    // Click "← Library"
    await backBtn.click();

    // Returned to Library view
    await expect(page.locator(".book-card")).toBeVisible();

    // Header has "Resume Reading" button
    await expect(
      page.locator("button:has-text('Resume Reading')"),
    ).toBeVisible();

    // Click "Resume Reading"
    await page.locator("button:has-text('Resume Reading')").click();
    await expect(iframe).toBeVisible();
  });
});
