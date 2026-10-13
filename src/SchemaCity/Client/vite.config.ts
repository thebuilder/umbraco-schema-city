import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
    // No source maps in the package: they were 6.9 MB of a 9.5 MB nupkg and the backoffice
    // never asks for them. The dev harness (npm run dev) runs through the Vite dev server,
    // which serves its own maps, so debugging the client is unaffected.
    sourcemap: false,
    rolldownOptions: {
      external: [/^@umbraco/],
      // Base UI marks its modules "use client", which means nothing in a browser-only
      // bundle, and the bundler warned once per module, 237 times a build.
      onLog(level, log, handler) {
        if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
      },
      // The scene chunk imports React from the entry chunk, which under "strict" makes
      // the bundler emit workspace.js as a stub in front of the real code.
      preserveEntrySignatures: "allow-extension",
      // Inlining a constant writes its value out at every use, and the element uses
      // the 65 kB stylesheet string inside a `??`, one of the places it inlines, so the
      // stylesheet shipped twice, once in app.js and once in the element's chunk.
      optimization: { inlineConst: false },
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
        //
        // Only what the entries load statically (`$initial`) goes in those two chunks.
        // three, r3f, drei and the scene's own modules are reached only through the lazy
        // Scene.tsx, so they fall through to Scene.js and load when the city first shows.
        codeSplitting: {
          groups: [
            { name: "vendor", test: /node_modules/, tags: ["$initial"] },
            { name: "app", test: /[\\/]src[\\/]app[\\/]/, tags: ["$initial"] },
          ],
        },
      },
    },
  },
});
