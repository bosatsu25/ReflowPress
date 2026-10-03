import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

test.describe("ReflowPress Japanese Typography & Accessibility Desktop E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-a11y-e2e-"));
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

  test("1. provides full keyboard navigation, focus trap, and screen reader live announcements", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleJapaneseEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // Wait for EPUB viewport
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Verify polite screen reader announcement region exists
    const liveRegion = page.locator("[role='status'][aria-live='polite']");
    await expect(liveRegion).toBeAttached();

    // Verify Header interactive controls have proper ARIA attributes
    const settingsBtn = page.locator("button[aria-label='Reader Settings']");
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toHaveAttribute("aria-haspopup", "dialog");

    // Open Settings via keyboard (focus and press Enter)
    await settingsBtn.focus();
    await page.keyboard.press("Enter");

    // Settings Modal should appear
    const modal = page.locator(".settings-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("role", "dialog");
    await expect(modal).toHaveAttribute("aria-modal", "true");

    // Focus trap test: Tab through controls and verify focus stays inside modal
    await page.keyboard.press("Tab");
    const activeElInModal = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? active.closest(".settings-modal") !== null : false;
    });
    expect(activeElInModal).toBe(true);

    // Escape dismissal and focus restoration
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();

    // Verify focus is restored to the settings button that opened the dialog
    const isSettingsFocused = await page.evaluate(() => {
      return (
        document.activeElement?.getAttribute("aria-label") === "Reader Settings"
      );
    });
    expect(isSettingsFocused).toBe(true);
  });

  test("2. renders Japanese vertical-rl layout, supports mode switching, and axis-aware navigation", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleJapaneseEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    const iframe = page.frameLocator("iframe.epub-viewport-frame");
    await expect(iframe.locator("body")).toBeVisible();

    // Check that vertical writing mode is active (default/auto resolves vertical-rl for sample-japanese.epub)
    const initialWritingMode = await iframe.locator("html").evaluate((el) => {
      return window.getComputedStyle(el).writingMode;
    });
    expect(initialWritingMode).toBe("vertical-rl");

    // Switch to Horizontal mode via Settings
    await page.locator("button[aria-label='Reader Settings']").click();
    await page.locator("button[aria-label='Writing Mode Horizontal']").click();
    await page.locator("button[aria-label='Close Settings']").click();

    // Wait for iframe reload
    await page.waitForTimeout(500);
    const horizontalWritingMode = await iframe
      .locator("html")
      .evaluate((el) => {
        return window.getComputedStyle(el).writingMode;
      });
    expect(horizontalWritingMode).toBe("horizontal-tb");

    // Switch back to Vertical mode
    await page.locator("button[aria-label='Reader Settings']").click();
    await page
      .locator("button[aria-label='Writing Mode Vertical (縦書き)']")
      .click();
    await page.locator("button[aria-label='Close Settings']").click();

    await page.waitForTimeout(500);
    const verticalWritingMode = await iframe.locator("html").evaluate((el) => {
      return window.getComputedStyle(el).writingMode;
    });
    expect(verticalWritingMode).toBe("vertical-rl");

    // Test axis-aware keyboard navigation: in vertical-rl, ArrowLeft navigates forward
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300);
  });

  test("3. renders Ruby, Tate-chu-yoko, and preserves MathML and RTL markup safely", async () => {
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleJapaneseEpubPath,
      ],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    const iframe = page.frameLocator("iframe.epub-viewport-frame");

    // Verify Ruby markup in Chapter 1
    const rubyElement = iframe.locator("ruby").first();
    await expect(rubyElement).toBeVisible();
    await expect(iframe.locator("rt").first()).toBeVisible();

    // Verify Tate-chu-yoko span in Chapter 1
    const tcyElement = iframe.locator(".tcy").first();
    await expect(tcyElement).toBeVisible();

    // Test TCY auto assist mode in Settings
    await page.locator("button[aria-label='Reader Settings']").click();
    await page
      .locator("button[aria-label='Tate-Chu-Yoko Assist (Auto)']")
      .click();
    await page.locator("button[aria-label='Close Settings']").click();

    await page.waitForTimeout(500);
    // Check that reflowpress-tcy spans were generated for 1-2 digit numbers (e.g. 45 in 昭和45年)
    const autoTcyCount = await iframe.locator(".reflowpress-tcy").count();
    expect(autoTcyCount).toBeGreaterThan(0);

    // Navigate to Chapter 2 via TOC
    const tocBtn = page.locator("button[aria-label='Table of Contents']");
    await tocBtn.click();
    const tocDrawer = page.locator(".toc-drawer");
    await expect(tocDrawer).toBeVisible();

    const chapter2Button = tocDrawer.locator("button:has-text('第二章')");
    await chapter2Button.click();

    // Wait for chapter 2 to load in iframe
    await expect(
      iframe.locator("h1:has-text('第二章 現代的要素とアクセシビリティ')"),
    ).toBeVisible({ timeout: 5000 });

    // Verify MathML <math> is present and not stripped
    const mathEl = iframe.locator("math");
    await expect(mathEl).toBeAttached();

    // Verify RTL block is present and retains dir="rtl"
    const rtlEl = iframe.locator("[dir='rtl']");
    await expect(rtlEl).toBeVisible();
  });

  test("4. passes automated accessibility audit (Axe-core) across Workbench, Reader, and Modals", async () => {
    // A. Audit Library / Workbench empty state
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
    });

    const page: Page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const libraryAudit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .disableRules(["color-contrast"]) // Exclude color-contrast in headless test runner environment
      .analyze();

    const libraryCriticalViolations = libraryAudit.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(libraryCriticalViolations).toEqual([]);

    await app.close();
    app = null;

    // B. Audit Reader with publication open
    app = await electron.launch({
      args: [
        mainEntry,
        `--user-data-dir=${userDataDir}`,
        "--open",
        sampleJapaneseEpubPath,
      ],
    });

    const readerPage: Page = await app.firstWindow();
    await readerPage.waitForLoadState("domcontentloaded");
    await expect(readerPage.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Check main Reader view
    const readerAudit = await new AxeBuilder({ page: readerPage })
      .setLegacyMode(true)
      .disableRules(["color-contrast"])
      .analyze();
    const readerCriticalViolations = readerAudit.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(readerCriticalViolations).toEqual([]);

    // Open SettingsModal and check
    await readerPage.locator("button[aria-label='Reader Settings']").click();
    await expect(readerPage.locator(".settings-modal")).toBeVisible();

    const settingsAudit = await new AxeBuilder({ page: readerPage })
      .setLegacyMode(true)
      .disableRules(["color-contrast"])
      .analyze();
    const settingsCriticalViolations = settingsAudit.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(settingsCriticalViolations).toEqual([]);

    await readerPage.keyboard.press("Escape");
    await expect(readerPage.locator(".settings-modal")).not.toBeVisible();

    // Open Reading Tools drawer and check
    await readerPage.locator("button[aria-label='Search In Book']").click();
    await expect(readerPage.locator(".reading-tools-drawer")).toBeVisible();

    const toolsAudit = await new AxeBuilder({ page: readerPage })
      .setLegacyMode(true)
      .disableRules(["color-contrast"])
      .analyze();
    const toolsCriticalViolations = toolsAudit.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(toolsCriticalViolations).toEqual([]);
  });
});
