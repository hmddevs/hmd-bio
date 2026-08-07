import path from "node:path";
import { defineConfig } from "vitest/config";

// `.mts` rather than `.ts`: the package is not `"type": "module"`, so Vite's
// native config loader would otherwise read this file as CommonJS and warn on
// the ESM syntax below.
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` -> `./src/*` mapping in tsconfig.json. Without it the
      // modules under test cannot resolve their own imports.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
