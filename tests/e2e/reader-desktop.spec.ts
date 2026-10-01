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

test.describe("ReflowPress Reader MVP Desktop E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-e2e-"));
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

  test("1. launches workbench and displays empty state with security guarantees", async () => {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Title verification
    await expect(page).toHaveTitle(/ReflowPress/);

    // Empty state UI elements
    await expect(page.locator("h1")).toHaveText("ReflowPress Workbench");
    await expect(
      page.locator("button:has-text('Open Publication')"),
    ).toBeVisible();
    await expect(page.locator("button:has-text('Open...')")).toBeVisible();

    // Security check: Node APIs must not leak into renderer
    const securityCheck = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      return {
        hasRequire: typeof win.require !== "undefined",
        hasProcess: typeof win.process !== "undefined",
        hasDesktopBridge: typeof win.reflowPressDesktop !== "undefined",
      };
    });

    expect(securityCheck.hasRequire).toBe(false);
    expect(securityCheck.hasProcess).toBe(false);
    expect(securityCheck.hasDesktopBridge).toBe(true);
  });

  test("2. loads EPUB, displays reflowable content, navigates TOC and chapters", async () => {
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

    // Publication title in header
    await expect(page.locator(".header-title")).toHaveText(
      "ReflowPress Sample Book",
    );

    // Verify footer initial state
    await expect(page.locator(".reader-footer")).toContainText(
      "Section 1 of 2",
    );

    // Verify sandboxed iframe
    const iframe = page.locator("iframe.epub-viewport-frame");
    await expect(iframe).toBeVisible();

    const sandboxAttr = await iframe.getAttribute("sandbox");
    expect(sandboxAttr).toContain("allow-same-origin");
    expect(sandboxAttr).not.toContain("allow-scripts");

    // Verify iframe content inside Section 1
    const frameContent = iframe.contentFrame();
    await expect(frameContent.locator("h1")).toHaveText(
      "Chapter 1: The Beginning",
    );
    await expect(frameContent.locator("body")).toContainText(
      "Welcome to ReflowPress Workbench",
    );

    // Open Table of Contents drawer
    const tocBtn = page.locator("button[aria-label='Table of Contents']");
    await tocBtn.click();
    await expect(page.locator(".toc-drawer")).toBeVisible();

    // Click Chapter 2 in TOC
    const chapter2Link = page.locator(
      ".toc-drawer button:has-text('Chapter 2: The Horizon')",
    );
    await expect(chapter2Link).toBeVisible();
    await chapter2Link.click();

    // TOC closes and section changes to 2
    await expect(page.locator(".toc-drawer")).not.toBeVisible();
    await expect(page.locator(".reader-footer")).toContainText(
      "Section 2 of 2",
    );
    await expect(frameContent.locator("h1")).toHaveText(
      "Chapter 2: The Horizon",
    );

    // Navigate back to Chapter 1 using Previous button
    const prevBtn = page.locator(
      "button[aria-label='Previous Page or Chapter']",
    );
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();

    await expect(page.locator(".reader-footer")).toContainText(
      "Section 1 of 2",
    );
    await expect(frameContent.locator("h1")).toHaveText(
      "Chapter 1: The Beginning",
    );
  });

  test("3. configures reader themes and typography settings", async () => {
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

    // Open Settings Modal
    const settingsBtn = page.locator("button[aria-label='Reader Settings']");
    await settingsBtn.click();

    const modal = page.locator(".settings-modal");
    await expect(modal).toBeVisible();

    // Switch to Dark theme
    await modal.locator("button:has-text('Dark')").click();
    await expect(page.locator(".reader-shell")).toHaveClass(/theme-dark/);

    // Switch to Sepia theme
    await modal.locator("button:has-text('Sepia')").click();
    await expect(page.locator(".reader-shell")).toHaveClass(/theme-sepia/);

    // Increase font size
    await modal.locator("button:has-text('A +')").click();

    // Close settings modal
    await modal.locator("button:has-text('Done')").click();
    await expect(modal).not.toBeVisible();
  });

  test("4. loads PDF publication, renders canvas, and navigates pages", async () => {
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

    // Title in header
    await expect(page.locator(".header-title")).toHaveText("sample");

    // Verify PDF viewer canvas is rendered
    const canvas = page.locator(".pdf-canvas-wrapper canvas");
    await expect(canvas).toBeVisible();

    // Footer page count
    await expect(page.locator(".reader-footer")).toContainText("Page 1 of 2");

    // Navigate to next page
    const nextBtn = page.locator("button[aria-label='Next Page or Chapter']");
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    await expect(page.locator(".reader-footer")).toContainText("Page 2 of 2");

    // Zoom controls
    const zoomText = page.locator(".pdf-floating-controls span");
    await expect(zoomText).toHaveText("100%");

    const zoomInBtn = page.locator("button[title='Zoom In']");
    await zoomInBtn.click();
    await expect(zoomText).toHaveText("125%");
  });

  test("5. persists and restores reading position across restarts", async () => {
    // 1st run: Open EPUB, starting at Section 1, move to Section 2
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

    await expect(page.locator(".reader-footer")).toContainText(
      "Section 1 of 2",
    );

    const nextBtn = page.locator("button[aria-label='Next Page or Chapter']");
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();
    await expect(page.locator(".reader-footer")).toContainText(
      "Section 2 of 2",
    );

    // Wait for debounce save (500ms) before closing
    await page.waitForTimeout(600);

    // Close application
    await app.close();
    app = null;

    // 2nd run: Relaunch with the same user-data-dir and same book
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

    // Should immediately restore Section 2
    await expect(page.locator(".reader-footer")).toContainText(
      "Section 2 of 2",
    );
    const frameContent = page
      .locator("iframe.epub-viewport-frame")
      .contentFrame();
    await expect(frameContent.locator("h1")).toHaveText(
      "Chapter 2: The Horizon",
    );
  });
});
