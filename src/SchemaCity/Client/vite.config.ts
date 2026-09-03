import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { GetModuleInfo } from "rollup";
import { defineConfig } from "vite";

const sceneOnlyCache = new Map<string, boolean>();

/** True when every path back from `id` to an entry point passes through Scene.tsx. */
function isSceneOnly(id: string, getModuleInfo: GetModuleInfo, stack = new Set<string>()): boolean {
  if (sceneOnlyCache.has(id)) return sceneOnlyCache.get(id) as boolean;
  if (id.endsWith("/Scene.tsx")) return true;
  if (stack.has(id)) return true; // a cycle with no outside importer found yet
  stack.add(id);

  const info = getModuleInfo(id);
  const importers = info ? [...info.importers, ...info.dynamicImporters] : [];
  // No importers means this id is an entry point itself, so it is never Scene-only.
  const result = importers.length > 0 && importers.every((importer) => isSceneOnly(importer, getModuleInfo, stack));
  sceneOnlyCache.set(id, result);
  return result;
}

export default defineConfig({
  plugins: [tailwindcss()],
  // Library mode leaves process.env.NODE_ENV in place, and React picks its build from
  // it at load time, so without this the backoffice throws on "process is not defined".
  // The dev server replaces it in prebundled dependencies before this ever applies.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/app", import.meta.url)) },
  },
  build: {
    lib: {
      entry: {
        workspace: "src/entry-workspace.tsx",
        "document-type-view": "src/entry-document-type-view.tsx",
      },
      formats: ["es"],
    },
    // Served by the host site as static web assets of this Razor Class Library.
    outDir: "../wwwroot/App_Plugins/SchemaCity",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: [/^@umbraco/],
      // The scene chunk imports React from the entry chunk, which under "strict" makes
      // Rollup emit workspace.js as a stub in front of the real code.
      preserveEntrySignatures: "allow-extension",
      // Flat names, because chunks in ES output resolve relative to the module that
      // imports them and the manifest only ever names workspace.js.
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        // Umbraco requests the entry as both "workspace.js" and "workspace.js?umb__rnd=…"
        // (its own cache-busting query on the manifest's element URL). Two URLs mean two
        // module instances, so a Scene.js that imported React and app code back from
        // workspace.js defined the custom element and loaded React twice, and the second
        // define() threw. Splitting node_modules and app code into their own chunks means
        // the entry has nothing worth importing back, so Scene.js never points at it.
        manualChunks(id, { getModuleInfo }) {
          if (id.includes("/src/app/") && !id.endsWith("/Scene.tsx")) return "app";
          if (!id.includes("node_modules")) return;
          // three, r3f and drei pull in a dozen unnamed helper packages (three-stdlib,
          // camera-controls, meshline...). Naming them here would miss the next one that
          // three or drei add, so a package only earns "vendor" when something outside
          // the lazy Scene subtree needs it eagerly; everything reachable only through
          // Scene.tsx falls through and rides in Scene.js instead.
          return isSceneOnly(id, getModuleInfo) ? undefined : "vendor";
        },
      },
    },
  },
});
