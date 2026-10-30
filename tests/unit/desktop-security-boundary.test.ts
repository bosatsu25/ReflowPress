import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  PathGrantRegistry,
  PathAccessDeniedError,
  samePath,
} from "../../apps/desktop/src/main/security/path-grants.js";
import { isTrustedSender } from "../../apps/desktop/src/main/security/ipc-guard.js";
import {
  APP_ENTRY_URL,
  isAppUrl,
  resolveAppAssetPath,
} from "../../apps/desktop/src/main/security/app-protocol.js";
import {
  isAllowedFrameNavigation,
  isAllowedNavigation,
  isAllowedRequestUrl,
} from "../../apps/desktop/src/main/security/session-hardening.js";
import {
  pickEditableBookFields,
  syncRecordsToCatalogBooks,
} from "../../apps/desktop/src/main/sync-catalog.js";
import type { LibraryBook } from "@reflowpress/library";

describe("PathGrantRegistry", () => {
  it("refuses paths that were never granted", () => {
    const grants = new PathGrantRegistry(path.posix);
    expect(grants.isGranted("/home/u/book.epub", "read")).toBe(false);
    expect(() =>
      grants.require("/home/u/book.epub", "read", "Opening"),
    ).toThrow(PathAccessDeniedError);
  });

  it("allows a granted file only for the granted access", () => {
    const grants = new PathGrantRegistry(path.posix);
    grants.grantFile("/home/u/book.epub", ["read"]);
    expect(grants.require("/home/u/book.epub", "read", "Opening")).toBe(
      "/home/u/book.epub",
    );
    expect(grants.isGranted("/home/u/book.epub", "write")).toBe(false);
    expect(grants.isGranted("/home/u/other.epub", "read")).toBe(false);
  });

  it("covers files inside a granted directory but not siblings or parents", () => {
    const grants = new PathGrantRegistry(path.posix);
    grants.grantDirectory("/media/KOBO", ["read", "write"]);
    expect(grants.isGranted("/media/KOBO/books/a.epub", "write")).toBe(true);
    expect(grants.isGranted("/media/KOBO", "write")).toBe(true);
    expect(grants.isGranted("/media/KOBO2/a.epub", "write")).toBe(false);
    expect(grants.isGranted("/media", "write")).toBe(false);
    expect(grants.isGranted("/media/KOBO/../secret", "read")).toBe(false);
  });

  it("treats a file named with leading dots as inside the directory", () => {
    const grants = new PathGrantRegistry(path.posix);
    grants.grantDirectory("/data", ["read"]);
    expect(grants.isGranted("/data/..hidden", "read")).toBe(true);
  });

  it("rejects non-string and NUL-containing input", () => {
    const grants = new PathGrantRegistry(path.posix);
    grants.grantDirectory("/data", ["read"]);
    expect(() => grants.require(42, "read", "x")).toThrow(
      PathAccessDeniedError,
    );
    expect(() => grants.require("/data/a\0b", "read", "x")).toThrow(
      PathAccessDeniedError,
    );
  });

  it("compares Windows paths case-insensitively and across drives", () => {
    const grants = new PathGrantRegistry(path.win32);
    grants.grantDirectory("D:\\Books", ["read"]);
    expect(grants.isGranted("d:\\books\\A.epub", "read")).toBe(true);
    expect(grants.isGranted("C:\\Books\\A.epub", "read")).toBe(false);
    expect(grants.isGranted("D:\\Books\\..\\Windows\\x", "read")).toBe(false);
    expect(samePath("C:\\A\\b.epub", "c:\\a\\B.EPUB", path.win32)).toBe(true);
  });
});

describe("isTrustedSender", () => {
  const appWindowId = 7;
  const frame = (url: string, parent: unknown = null) => ({ url, parent });

  it("accepts the top-level app frame of the main window", () => {
    expect(
      isTrustedSender(
        { sender: { id: appWindowId }, senderFrame: frame(APP_ENTRY_URL) },
        appWindowId,
        isAppUrl,
      ),
    ).toBe(true);
  });

  it("rejects subframes, other windows, foreign URLs and destroyed frames", () => {
    expect(
      isTrustedSender(
        {
          sender: { id: appWindowId },
          senderFrame: frame(APP_ENTRY_URL, { url: APP_ENTRY_URL }),
        },
        appWindowId,
        isAppUrl,
      ),
    ).toBe(false);
    expect(
      isTrustedSender(
        { sender: { id: 99 }, senderFrame: frame(APP_ENTRY_URL) },
        appWindowId,
        isAppUrl,
      ),
    ).toBe(false);
    expect(
      isTrustedSender(
        {
          sender: { id: appWindowId },
          senderFrame: frame("file:///tmp/evil.html"),
        },
        appWindowId,
        isAppUrl,
      ),
    ).toBe(false);
    expect(
      isTrustedSender(
        { sender: { id: appWindowId }, senderFrame: null },
        appWindowId,
        isAppUrl,
      ),
    ).toBe(false);
  });
});

describe("resolveAppAssetPath", () => {
  const root = "/opt/reflowpress/renderer";

  it("maps app URLs to files under the renderer root", () => {
    expect(resolveAppAssetPath(root, APP_ENTRY_URL, path.posix)).toBe(
      `${root}/index.html`,
    );
    expect(resolveAppAssetPath(root, "app://reflowpress/", path.posix)).toBe(
      `${root}/index.html`,
    );
    expect(
      resolveAppAssetPath(
        root,
        "app://reflowpress/assets/pdf.worker.min.mjs?v=1",
        path.posix,
      ),
    ).toBe(`${root}/assets/pdf.worker.min.mjs`);
  });

  it("never resolves outside the renderer root", () => {
    for (const url of [
      "app://reflowpress/../../etc/passwd",
      "app://reflowpress/%2e%2e/%2e%2e/etc/passwd",
      "app://reflowpress/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret",
      "app://reflowpress/assets/..%2F..%2F..%2Fsecret",
    ]) {
      const resolved = resolveAppAssetPath(root, url, path.posix);
      if (resolved !== null) {
        expect(resolved.startsWith(`${root}/`)).toBe(true);
      }
    }
  });

  it("refuses other hosts, other schemes and malformed input", () => {
    for (const url of [
      "app://other-host/index.html",
      "file:///opt/reflowpress/renderer/index.html",
      "app://reflowpress/%E0%A4%A",
      "app://reflowpress/a%00b",
      "not a url",
    ]) {
      expect(resolveAppAssetPath(root, url, path.posix)).toBeNull();
    }
  });

  it("refuses backslash traversal on Windows", () => {
    expect(
      resolveAppAssetPath(
        "C:\\App\\renderer",
        "app://reflowpress/..%5C..%5CWindows%5Cwin.ini",
        path.win32,
      ),
    ).toBeNull();
  });
});

describe("renderer network and navigation policy", () => {
  it("allows only bundled, blob and data URLs in production", () => {
    expect(isAllowedRequestUrl("app://reflowpress/assets/x.js", null)).toBe(
      true,
    );
    expect(isAllowedRequestUrl("blob:app://reflowpress/uuid", null)).toBe(true);
    expect(isAllowedRequestUrl("data:image/png;base64,AA", null)).toBe(true);
    expect(isAllowedRequestUrl("https://tracker.example/p.gif", null)).toBe(
      false,
    );
    expect(isAllowedRequestUrl("http://127.0.0.1:3000/opds", null)).toBe(false);
    expect(isAllowedRequestUrl("file:///etc/passwd", null)).toBe(false);
    expect(isAllowedRequestUrl("http://localhost:5173/", null)).toBe(false);
  });

  it("allows the Vite dev server only when one is configured", () => {
    const dev = "http://localhost:5173";
    expect(isAllowedRequestUrl("http://localhost:5173/src/main.tsx", dev)).toBe(
      true,
    );
    expect(isAllowedRequestUrl("ws://localhost:5173/", dev)).toBe(true);
    expect(isAllowedRequestUrl("http://localhost:5174/", dev)).toBe(false);
  });

  it("keeps navigation inside the app and lets the book iframe use srcdoc", () => {
    expect(isAllowedNavigation(APP_ENTRY_URL, null)).toBe(true);
    expect(isAllowedNavigation("https://example.com/", null)).toBe(false);
    expect(isAllowedNavigation("file:///C:/evil.html", null)).toBe(false);
    expect(isAllowedFrameNavigation("about:srcdoc", null)).toBe(true);
    expect(isAllowedFrameNavigation("https://example.com/", null)).toBe(false);
  });
});

describe("sync catalog mapping", () => {
  const localBook: LibraryBook = {
    id: "book-1",
    filePath: "/library/book.epub",
    format: "epub",
    title: "Old Title",
    dateAdded: "2026-01-01T00:00:00.000Z",
    fileSizeBytes: 1234,
    modifiedTimeMs: 1,
    coverPath: "/covers/book-1.png",
    tags: [],
    collectionIds: [],
    availability: { exists: true, lastChecked: "2026-01-01T00:00:00.000Z" },
  };

  it("keeps local file paths when a sync or restore updates a book", () => {
    const [book] = syncRecordsToCatalogBooks(
      [
        {
          id: "book-1",
          rev: "r2",
          updatedAt: "2026-02-01T00:00:00.000Z",
          installationId: "other",
          data: {
            portableId: "book-1",
            title: "New Title",
            format: "epub",
            tags: ["sf"],
          },
        },
      ],
      [localBook],
    );
    expect(book?.filePath).toBe("/library/book.epub");
    expect(book?.coverPath).toBe("/covers/book-1.png");
    expect(book?.title).toBe("New Title");
    expect(book?.tags).toEqual(["sf"]);
  });

  it("adds remote-only books without a file path", () => {
    const [book] = syncRecordsToCatalogBooks(
      [
        {
          id: "remote",
          rev: "r1",
          updatedAt: "2026-02-01T00:00:00.000Z",
          installationId: "other",
          data: { portableId: "remote", title: "Remote", format: "pdf" },
        },
      ],
      [localBook],
    );
    expect(book?.filePath).toBe("");
    expect(book?.availability.exists).toBe(false);
  });

  it("lets the renderer change only user metadata on a book", () => {
    expect(
      pickEditableBookFields({
        lastOpened: "2026-03-01T00:00:00.000Z",
        filePath: "/etc/shadow",
        id: "other",
        coverPath: "/etc/passwd.png",
        tags: ["a", 1],
      }),
    ).toEqual({ lastOpened: "2026-03-01T00:00:00.000Z" });
    expect(pickEditableBookFields(null)).toEqual({});
  });
});
