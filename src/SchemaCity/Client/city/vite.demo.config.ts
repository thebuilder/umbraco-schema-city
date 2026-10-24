import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { uiAlias } from "../vite.shared.ts";

// The public demo: the City's fixture harness as a static site, written to Client/dist.
export default defineConfig({
  root: fileURLToPath(new URL("./dev", import.meta.url)),
  plugins: [tailwindcss()],
  resolve: { alias: uiAlias },
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    // As in vite.config.ts: Base UI's "use client" means nothing in the browser.
    rolldownOptions: { checks: { moduleLevelDirective: false } },
  },
});
