import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { appPlugins, uiAlias } from "./vite.shared.ts";

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** A variant's own entry module, so its chunk is named for it rather than "index". */
const VARIANT_ENTRY = /[\\/](city|clean)[\\/]src[\\/]index\.tsx$/;

/**
 * The whole client in one build: the two entries Umbraco loads from the manifest,
 * which hold the element and no React, and the two variants the element imports
 * when asked for. React and the shared panels are one chunk both variants load, so
 * switching does not fetch React again. three.js is reached only through the City's
 * lazy Scene and React Flow only through the clean variant's lazy Board, so neither
 * loads with the other. `pnpm dev` and `pnpm dev:city` serve each variant's fixture
 * harness from its dev/ folder with this same config.
 */
export default defineConfig({
  plugins: [tailwindcss()],
  // Library mode leaves process.env.NODE_ENV in place, and React picks its build from
  // it at load time, so without this the backoffice throws on "process is not defined".
  // The dev server replaces it in prebundled dependencies before this ever applies.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: uiAlias },
  // Umbraco serves umbraco-package.json from beside the entries.
  publicDir: entry("./backoffice/public"),
  build: {
    lib: {
      entry: {
        workspace: entry("./backoffice/src/entry-workspace.ts"),
        "document-type-view": entry(
          "./backoffice/src/entry-document-type-view.ts"
        ),
      },
      formats: ["es"],
    },
    outDir: appPlugins,
    emptyOutDir: true,
    // No source maps in the package: they were 6.9 MB of a 9.5 MB nupkg and the
    // backoffice never asks for them. The dev harness serves its own.
    sourcemap: false,
    rolldownOptions: {
      external: [/^@umbraco/],
      // Base UI marks its modules "use client", which means nothing in a browser-only
      // bundle, and the bundler warned once per module, 237 times a build.
      checks: { moduleLevelDirective: false },
      // The entries keep fixed names for the manifest, and Umbraco busts their cache
      // with its own query. Every other chunk carries a content hash, because the site
      // sends no Cache-Control, so after an upgrade a browser could otherwise pair a
      // new entry with an old chunk.
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: (chunk) =>
          `${chunk.facadeModuleId?.match(VARIANT_ENTRY)?.[1] ?? "[name]"}-[hash].js`,
        assetFileNames: "[name][extname]",
      },
    },
  },
});
