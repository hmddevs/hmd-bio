import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output from `vercel build`, which is generated, not authored.
    ".vercel/**",
    // Build output from `opennextjs-cloudflare build`. Linting the bundled
    // chunks in here exhausts the Node heap, so it must stay ignored.
    ".open-next/**",
    // Wrangler's local state and dev-server scratch space. `.wrangler/tmp`
    // holds whole bundled workers, which OOM the linter the same way, and a
    // dev server that is killed rather than stopped leaves them behind.
    ".wrangler/**",
    // One-off ops scripts (excluded from tsc compilation too)
    "scripts/**",
  ]),
]);

export default eslintConfig;
