import { DOCS_ACCENT } from "@thebuilder/umbraco-docs";
import { defineOgConfig } from "@thebuilder/umbraco-docs/og";
import { fileURLToPath } from "node:url";

export default defineOgConfig({
  contentDir: fileURLToPath(new URL("./content", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  prefix: "/og",
  brand: "TheBuilder · Schema City",
  // The card is always dark, so its glow takes the shared accent's dark shade.
  accent: DOCS_ACCENT.dark,
  logo: "/logo-mark.svg",
  root: {
    title: "Schema City for Umbraco",
    description:
      "See your Umbraco content model as a city in the backoffice, and catch schema problems before they ship.",
  },
});
