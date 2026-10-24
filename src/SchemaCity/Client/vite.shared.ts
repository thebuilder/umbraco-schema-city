import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";

/** Where the Razor Class Library serves the client from. */
export const appPlugins = fileURLToPath(
  new URL("../wwwroot/App_Plugins/SchemaCity", import.meta.url)
);

/** The shared panels import their own components through "@". */
export const uiAlias = {
  "@": fileURLToPath(new URL("./ui/src", import.meta.url)),
};

/**
 * The public demo: a variant's fixture harness as a static site in Client/dist, the
 * map at the root and the City under /city/, as the docs link them. The map's build
 * runs first and empties dist; the City's writes beside it.
 */
export const demoConfig = (variant: "clean" | "city"): UserConfig => {
  const city = variant === "city";
  return {
    root: fileURLToPath(new URL(`./${variant}/dev`, import.meta.url)),
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
};
