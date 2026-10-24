import { defineUmbracoPackage } from "@thebuilder/umbraco-docs";

export const schemaCityPackage = defineUmbracoPackage({
  id: "thebuilder.schemacity",
  name: "Schema City",
  summary:
    "Shows your Document Types as a map in the backoffice, or as a city in 3D, with the links between them, and flags schema problems before they ship.",
  links: {
    docs: "https://schema-city.thebuilder.dk",
    nuget: "https://www.nuget.org/packages/TheBuilder.SchemaCity",
    marketplace: "https://marketplace.umbraco.com/package/thebuilder.schemacity",
    github: "https://github.com/thebuilder/umbraco-schema-city",
  },
  logo: "/logo-mark.svg",
  compatibility: {
    umbraco: ">=17 <19",
    dotnet: ">=10",
  },
  status: "preview",
  categories: ["Developer Tools", "Editor Tools"],
});
