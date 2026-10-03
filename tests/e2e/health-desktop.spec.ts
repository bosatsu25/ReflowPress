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

test.describe("ReflowPress Health & Safe Repair Desktop Workbench E2E", () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string = "";

  test.beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(tmpdir(), "reflowpress-health-e2e-"));
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

  test("opens Health & Safe Repair modal, displays diagnostics, and passes axe accessibility audit", async () => {
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

    // Locate and click Health button in header
    const healthButton = page.locator(
      'button[aria-label="Publication Health and Safe Repair"]',
    );
    await expect(healthButton).toBeVisible();
    await healthButton.click();

    // Verify modal dialog opens
    const modal = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible();
    await expect(page.locator("#health-modal-title")).toHaveText(
      "Publication Health & Safe Repair",
    );

    // Verify live status announcement region exists inside modal
    const statusRegion = modal.locator(
      'div[role="status"][aria-live="polite"]',
    );
    await expect(statusRegion).toBeVisible();

    // Switch between Diagnostics and Safe Repair tabs
    const diagnosticsTab = page.locator('button:has-text("Diagnostics")');
    const repairTab = page.locator('button:has-text("Safe Repair")');

    await expect(diagnosticsTab).toBeVisible();
    await expect(repairTab).toBeVisible();

    await repairTab.click();
    await expect(
      page.locator("text=strictly safe, non-destructive repairs"),
    ).toBeVisible();

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
    const closeButton = page.locator(
      'button[aria-label="Close Health & Repair Dialog"]',
    );
    await closeButton.click();
    await expect(modal).not.toBeVisible();
  });
});
