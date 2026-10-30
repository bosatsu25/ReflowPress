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
  const sessionHardeningPath = path.resolve(
    __dirname,
    "../../apps/desktop/src/main/security/session-hardening.ts",
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

    // No plugin content, base rewriting or form posts, and no blob scripts
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("script-src 'self';");
  });

  it("keeps the meta CSP identical to the app:// response header", async () => {
    const htmlContent = await fs.readFile(indexHtmlPath, "utf8");
    const meta = htmlContent.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )![1];
    const { CONTENT_SECURITY_POLICY } =
      await import("../../apps/desktop/src/main/security/app-protocol.js");
    // frame-ancestors is only honoured as a header, so the meta omits it.
    expect(meta).toBe(
      CONTENT_SECURITY_POLICY.replace("; frame-ancestors 'none'", ""),
    );
  });

  it("enforces contextIsolation, sandbox, and disables nodeIntegration in main process", async () => {
    const mainContent = await fs.readFile(mainTsPath, "utf8");

    // Critical Electron security flags
    expect(mainContent).toContain("contextIsolation: true");
    expect(mainContent).toContain("sandbox: true");
    expect(mainContent).toContain("nodeIntegration: false");

    expect(mainContent).toContain("webviewTag: false");
    expect(mainContent).toContain("spellcheck: false");

    // Every WebContents is hardened and the renderer is served from app://
    expect(mainContent).toContain('app.on("web-contents-created"');
    expect(mainContent).toContain("hardenSession(session.defaultSession");
    expect(mainContent).toContain("loadURL(APP_ENTRY_URL)");
    expect(mainContent).not.toContain("loadFile(");

    const hardening = await fs.readFile(sessionHardeningPath, "utf8");
    expect(hardening).toContain("setWindowOpenHandler");
    expect(hardening).toContain('action: "deny"');
    expect(hardening).toContain("will-navigate");
    expect(hardening).toContain("will-attach-webview");
    expect(hardening).toContain("setPermissionRequestHandler");
    expect(hardening).toContain("onBeforeRequest");
  });
});
