export const manifests: Array<UmbExtensionManifest> = [
  {
    name: "Schema City Entrypoint",
    alias: "SchemaCity.Entrypoint",
    type: "backofficeEntryPoint",
    js: () => import("./entrypoint.js"),
  },
];
