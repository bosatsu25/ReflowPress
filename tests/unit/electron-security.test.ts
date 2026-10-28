import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Electron Security Hardening", () => {
  const indexHtmlPath = path.resolve(
    __dirname,
    "../../apps/desktop/src/renderer/index.html",
  );
  const mainTsPath = path.resolve(
    __dirname,
    "../../apps/desktop/src/main/main.ts",
  );

  it("enforces strict Content-Security-Policy (CSP) in renderer index.html", async () => {
    const htmlContent = await fs.readFile(indexHtmlPath, "utf8");

    // Must define http-equiv="Content-Security-Policy"
    expect(htmlContent).toContain('http-equiv="Content-Security-Policy"');

    // Extract CSP string
    const match = htmlContent.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    );
    expect(match).not.toBeNull();
    const csp = match![1];

    // Must restrict default-src to self
    expect(csp).toContain("default-src 'self'");

    // Must not allow unsafe-eval
    expect(csp).not.toContain("'unsafe-eval'");

    // Must restrict worker-src and connect-src
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self' blob:");
  });

  it("enforces contextIsolation, sandbox, and disables nodeIntegration in main process", async () => {
    const mainContent = await fs.readFile(mainTsPath, "utf8");

    // Critical Electron security flags
    expect(mainContent).toContain("contextIsolation: true");
    expect(mainContent).toContain("sandbox: true");
    expect(mainContent).toContain("nodeIntegration: false");

    // External window open denial
    expect(mainContent).toContain("setWindowOpenHandler");
    expect(mainContent).toContain('action: "deny"');

    // Navigation allowlist
    expect(mainContent).toContain("will-navigate");
    expect(mainContent).toContain("event.preventDefault()");
  });
});
