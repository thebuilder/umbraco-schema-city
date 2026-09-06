import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "dev",
  plugins: [tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/app", import.meta.url)) },
  },
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
