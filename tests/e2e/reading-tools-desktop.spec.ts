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

const sampleEpubPath = path.resolve(rootDir, "tests/fixtures/sample.epub");
const samplePdfPath = path.resolve(rootDir, "tests/fixtures/sample.pdf");
const mainEntry = path.resolve(rootDir, "apps/desktop/dist/main/main.js");

test.describe("ReflowPress Reading Tools Desktop E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-tools-e2e-"));
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

  test("1. searches EPUB publication and jumps to search results", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Wait for EPUB viewport
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Header buttons should include Search, Bookmark, Tools
    const searchBtn = page.locator("button[aria-label='Search In Book']");
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();

    // Reading Tools Drawer should open on Search tab
    const drawer = page.locator(".reading-tools-drawer");
    await expect(drawer).toBeVisible();

    const searchInput = drawer.locator(
      "input[placeholder*='Search in this publication']",
    );
    await expect(searchInput).toBeVisible();

    // Search for a word known to exist in sample.epub (e.g. "Chapter")
    await searchInput.fill("Chapter");

    // Verify search match appears
    const resultItem = drawer.locator(".tab-pane-search mark");
    await expect(resultItem.first()).toBeVisible({ timeout: 5000 });

    // Click on result to jump
    await resultItem.first().click();

    // Iframe content should be displayed
    const iframe = page.frameLocator("iframe.epub-viewport-frame");
    await expect(iframe.locator("body")).toBeVisible();
  });

  test("2. creates and manages bookmarks and notes in EPUB reader", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Click quick bookmark in header
    const bookmarkBtn = page.locator("button[aria-label='Quick Bookmark']");
    await expect(bookmarkBtn).toBeVisible();
    await bookmarkBtn.click();

    // Reading Tools drawer opens to bookmarks tab
    const drawer = page.locator(".reading-tools-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(".tab-pane-bookmarks")).toBeVisible();

    // Add a custom bookmark label
    const bookmarkInput = drawer.locator(
      "input[placeholder*='Optional bookmark note']",
    );
    await bookmarkInput.fill("E2E Test Bookmark");
    await drawer.locator("button:has-text('+ Add')").click();

    await expect(drawer.locator("text=E2E Test Bookmark")).toBeVisible();

    // Switch to Notes tab
    await drawer.locator("button:has-text('📝')").click();
    await expect(drawer.locator(".tab-pane-notes")).toBeVisible();

    // Add a standalone note
    const noteArea = drawer.locator("textarea[placeholder*='Type your notes']");
    await noteArea.fill("This is my E2E reading note.");
    await drawer.locator("button:has-text('Save Note')").click();

    await expect(
      drawer.locator("text=This is my E2E reading note."),
    ).toBeVisible();
  });

  test("3. searches PDF document and creates page bookmarks", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        samplePdfPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Wait for PDF canvas wrapper
    await expect(page.locator(".pdf-canvas-wrapper")).toBeVisible({
      timeout: 10000,
    });

    // Open Search tab in tools drawer
    const searchBtn = page.locator("button[aria-label='Search In Book']");
    await searchBtn.click();

    const drawer = page.locator(".reading-tools-drawer");
    await expect(drawer).toBeVisible();

    // Search query in PDF
    const searchInput = drawer.locator(
      "input[placeholder*='Search in this publication']",
    );
    await searchInput.fill("sample");

    // Add bookmark on PDF page
    await drawer.locator("button:has-text('🔖')").click();
    await expect(drawer.locator(".tab-pane-bookmarks")).toBeVisible();
    await drawer.locator("button:has-text('+ Add')").click();

    // Page 1 bookmark should be listed
    await expect(drawer.locator("text=Page 1")).toBeVisible();
  });

  test("4. verifies annotation persistence across application restarts", async () => {
    // Session 1: Create a bookmark
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleEpubPath,
      ],
    });

    let page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    const bookmarkBtn = page.locator("button[aria-label='Quick Bookmark']");
    await bookmarkBtn.click();

    const drawer = page.locator(".reading-tools-drawer");
    const bookmarkInput = drawer.locator(
      "input[placeholder*='Optional bookmark note']",
    );
    await bookmarkInput.fill("Persisted Bookmark");
    await drawer.locator("button:has-text('+ Add')").click();
    await expect(drawer.locator("text=Persisted Bookmark")).toBeVisible();

    // Close application
    await app.close();
    app = null;

    // Session 2: Relaunch with same userDataDir
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleEpubPath,
      ],
    });

    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Open tools drawer
    const toolsBtn = page.locator("button[aria-label='Reading Tools']");
    await toolsBtn.click();

    // Open bookmarks tab
    const drawer2 = page.locator(".reading-tools-drawer");
    await drawer2.locator("button:has-text('🔖')").click();

    // Verified persisted bookmark is present!
    await expect(drawer2.locator("text=Persisted Bookmark")).toBeVisible();
  });

  test("5. verifies export and import controls in Reading Tools drawer", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Open tools drawer
    await page.locator("button[aria-label='Reading Tools']").click();
    const drawer = page.locator(".reading-tools-drawer");
    await expect(drawer).toBeVisible();

    // Verify Export controls (MD, HTML, JSON) and Import button
    await expect(drawer.locator("button[title*='Markdown']")).toBeVisible();
    await expect(drawer.locator("button[title*='HTML']")).toBeVisible();
    await expect(
      drawer.locator("button[title*='Export portable annotations JSON']"),
    ).toBeVisible();
    await expect(
      drawer.locator("button:has-text('Import JSON')"),
    ).toBeVisible();
  });
});
