import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The favicon is drawn from the logo, so they cannot drift apart. The NuGet icon,
// src/SchemaCity/icon.png, is the package's own and stays as it is.
const docsRoot = fileURLToPath(new URL("../", import.meta.url));

await sharp(`${docsRoot}public/logo-mark.svg`)
  .resize(256, 256)
  .png()
  .toFile(`${docsRoot}favicon.png`);

console.log("Generated favicon.png from public/logo-mark.svg.");
