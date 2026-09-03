import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/entry-workspace.ts",
      formats: ["es"],
      fileName: "workspace",
    },
    // Served by the host site as static web assets of this Razor Class Library.
    outDir: "../wwwroot/App_Plugins/SchemaCity",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: [/^@umbraco/],
    },
  },
});
