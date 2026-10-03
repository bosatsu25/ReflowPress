import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@reflowpress/annotations": path.resolve(
        __dirname,
        "packages/annotations/src/index.ts",
      ),
      "@reflowpress/core": path.resolve(
        __dirname,
        "packages/core/src/index.ts",
      ),
      "@reflowpress/epub": path.resolve(
        __dirname,
        "packages/epub/src/index.ts",
      ),
      "@reflowpress/library": path.resolve(
        __dirname,
        "packages/library/src/index.ts",
      ),
      "@reflowpress/reader": path.resolve(
        __dirname,
        "packages/reader/src/index.ts",
      ),
      "@reflowpress/renderer": path.resolve(
        __dirname,
        "packages/renderer/src/index.ts",
      ),
      "@reflowpress/pdf": path.resolve(__dirname, "packages/pdf/src/index.ts"),
      "@reflowpress/search": path.resolve(
        __dirname,
        "packages/search/src/index.ts",
      ),
      "@reflowpress/validation": path.resolve(
        __dirname,
        "packages/validation/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
