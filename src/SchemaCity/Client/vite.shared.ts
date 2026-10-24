import { fileURLToPath } from "node:url";

/** Where the Razor Class Library serves the client from. */
export const appPlugins = fileURLToPath(
  new URL("../wwwroot/App_Plugins/SchemaCity", import.meta.url)
);

/** The shared panels import their own components through "@". */
export const uiAlias = {
  "@": fileURLToPath(new URL("./ui/src", import.meta.url)),
};
