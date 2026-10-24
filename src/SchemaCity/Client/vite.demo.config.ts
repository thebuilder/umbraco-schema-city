import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { uiAlias } from "./vite.shared.ts";

/**
 * The public demo: each variant's fixture harness as a static site in Client/dist,
 * the map at the root and the City under /city/, as the docs link them.
 * `--mode city` builds the City's half; the map's runs first and empties dist.
 */
export default defineConfig(({ mode }) => {
  const city = mode === "city";
  return {
    root: fileURLToPath(
      new URL(city ? "./city/dev" : "./clean/dev", import.meta.url)
    ),
    base: city ? "/city/" : "/",
    plugins: [tailwindcss()],
    resolve: { alias: uiAlias },
    publicDir: false,
    build: {
      outDir: fileURLToPath(
        new URL(city ? "./dist/city" : "./dist", import.meta.url)
      ),
      emptyOutDir: !city,
      sourcemap: false,
      // As in vite.config.ts: Base UI's "use client" means nothing in the browser.
      rolldownOptions: { checks: { moduleLevelDirective: false } },
    },
  };
});
