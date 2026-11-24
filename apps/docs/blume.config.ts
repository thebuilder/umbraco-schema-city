import { docsTheme } from "@thebuilder/umbraco-docs";
import { defineConfig } from "blume";
import { script, vercel } from "blume/analytics";
import { schemaCityPackage } from "./umbraco-package";

export default defineConfig({
  title: schemaCityPackage.name,
  description:
    "See your Umbraco content model from above, as a city plan in the backoffice, and catch schema problems before they ship.",
  logo: {
    image: "/logo-mark.svg",
    text: "Schema City",
  },
  github: {
    owner: "thebuilder",
    repo: "umbraco-schema-city",
    dir: "apps/docs",
  },
  content: {
    root: "content",
  },
  navigation: {
    // A custom landing page owns "/", so the Docs tab links to the overview
    // while keeping path "/" to stay highlighted across every docs route.
    tabs: [{ label: "Docs", path: "/", href: "/overview" }],
  },
  deployment: {
    site: "https://schema-city.thebuilder.dk",
  },
  seo: {
    // Package-owned cards are generated into public/og before Blume builds.
    // Disable Blume's generated /og routes so it cannot overwrite them.
    og: { enabled: false },
  },
  analytics: [
    vercel(),
    // Pageflock, in the thebuilder workspace, with outbound links, downloads and 404s counted too.
    script({
      src: "https://e.pageflock.com/s.auto.js",
      strategy: "defer",
      attributes: { "data-site": "schema-city-thebuilder-dk" },
    }),
  ],
  // The docs family's shared accent and fonts, so every package site looks alike.
  theme: { ...docsTheme },
  agents: {
    llmsTxt: true,
  },
});
