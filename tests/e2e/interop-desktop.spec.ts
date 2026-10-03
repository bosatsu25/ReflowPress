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

const sampleEpubPath = path.resolve(rootDir, "tests/fixtures/sample.epub");
const mainEntry = path.resolve(rootDir, "apps/desktop/dist/main/main.js");

test.describe("ReflowPress Interoperability & Data Portability Desktop Workbench E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(
      path.join(tmpdir(), "reflowpress-interop-e2e-"),
    );
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

  test("opens Interoperability modal, switches tabs across OPDS, Sync, Backup, and Device, and passes axe accessibility audit", async () => {
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

    // Wait for publication to load
    await expect(page.locator("iframe.epub-viewport-frame")).toBeVisible({
      timeout: 10000,
    });

    // Locate and click Interop button in header
    const interopButton = page.locator(
      'button[aria-label="Interoperability and Sync"]',
    );
    await expect(interopButton).toBeVisible();
    await interopButton.click();

    // Verify modal dialog opens
    const modal = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    await expect(page.locator("#interop-modal-title")).toHaveText(
      "Interoperability & Data Portability",
    );

    // Verify all 4 tabs exist
    const opdsTab = page.locator('button:has-text("OPDS 2.0 Catalog")');
    const syncTab = page.locator('button:has-text("Library Sync")');
    const backupTab = page.locator('button:has-text("Backup & Restore")');
    const deviceTab = page.locator('button:has-text("E-Reader Devices")');

    await expect(opdsTab).toBeVisible();
    await expect(syncTab).toBeVisible();
    await expect(backupTab).toBeVisible();
    await expect(deviceTab).toBeVisible();

    // Verify OPDS controls are present
    await expect(page.locator("text=Local OPDS 2.0 Server")).toBeVisible();

    // Switch to Library Sync tab
    await syncTab.click();
    await expect(page.locator("text=Shared Folder Sync")).toBeVisible();
    await expect(page.locator("text=WebDAV Remote Sync")).toBeVisible();

    // Switch to Backup & Restore tab
    await backupTab.click();
    await expect(page.locator("text=Create Backup Bundle")).toBeVisible();
    await expect(page.locator("text=Restore from Backup")).toBeVisible();

    // Switch to E-Reader Devices tab
    await deviceTab.click();
    await expect(page.locator("text=Detect Connected Device")).toBeVisible();

    // Run Axe accessibility scan on the modal
    const axeResults = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .include('div[role="dialog"][aria-modal="true"]')
      .disableRules(["color-contrast"])
      .analyze();

    // Must have zero critical or serious accessibility violations
    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(seriousOrCritical).toEqual([]);

    // Close modal via close button
    const closeButton = page.locator('button[aria-label="Close dialog"]');
    await closeButton.click();
    await expect(modal).not.toBeVisible();
  });
});
