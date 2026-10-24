import { docsTheme } from "@thebuilder/umbraco-docs";
import { defineConfig } from "blume";
import { vercel } from "blume/analytics";
import { schemaCityPackage } from "./umbraco-package";

export default defineConfig({
  title: schemaCityPackage.name,
  description:
    "See your Umbraco content model as a map in the backoffice, or as a city in 3D, and catch schema problems before they ship.",
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
  analytics: [vercel()],
  // The docs family's shared accent and fonts, so every package site looks alike.
  theme: { ...docsTheme },
  agents: {
    llmsTxt: true,
  },
});
