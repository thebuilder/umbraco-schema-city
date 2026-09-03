import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
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
      entry: { workspace: "src/entry-workspace.tsx" },
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
      },
    },
  },
});
