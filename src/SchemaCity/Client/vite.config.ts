import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/entry-dashboard.ts",
      formats: ["es"],
      fileName: "dashboard",
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
