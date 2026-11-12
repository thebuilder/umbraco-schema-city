import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The favicon and the package icon are drawn from the logo, so they cannot drift apart.
const docsRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const mark = `${docsRoot}public/logo-mark.svg`;

// The favicon lives in public/ so Blume links it by URL. A root-level icon gets inlined as a data URI in every
// page's head, which pushes the og: tags past the 32 KB Slack reads, so links get no preview.
await sharp(mark).resize(256, 256).png().toFile(`${docsRoot}public/favicon.png`);

// The NuGet and Umbraco Marketplace icon: the mark on the dark tile the other TheBuilder packages
// use, a #15152e to #08080f diagonal with a purple-blue glow at the top.
const tile = 512;
const radius = 114;
const background = `<svg width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15152e"/><stop offset="1" stop-color="#08080f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.02" r="0.9">
      <stop offset="0" stop-color="#6d5ef7" stop-opacity="0.38"/>
      <stop offset="0.55" stop-color="#3b82f6" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#3b82f6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${tile}" height="${tile}" rx="${radius}" fill="url(#bg)"/>
  <rect width="${tile}" height="${tile}" rx="${radius}" fill="url(#glow)"/>
</svg>`;

// The isometric mark has empty space around it, so it is trimmed before it is sized to fill the tile.
const trimmed = await sharp(mark, { density: 600 }).trim().png().toBuffer();
const art = await sharp(trimmed).resize(400, 400, { fit: "inside" }).png().toBuffer();

await sharp(Buffer.from(background))
  .composite([{ input: art, gravity: "center" }])
  .png()
  .toFile(`${repoRoot}src/SchemaCity/icon.png`);

console.log("Generated public/favicon.png and src/SchemaCity/icon.png from public/logo-mark.svg.");
