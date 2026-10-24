// Re-encodes a 24-bit PNG as a 256-colour indexed one, for the screenshots in
// docs/screenshots. macOS ships no pngquant and sips only makes these files bigger,
// so this is the one place the repo owns a PNG encoder. Node's zlib does the
// compression; everything here is chunk plumbing and a palette.
//
// Only what a screenshot needs: 8-bit RGB or RGBA input, no interlacing, no
// transparency out. Anything else throws rather than writing a wrong file.
import zlib from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xff_ff_ff_ff;
  for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** The PNG's pixels, filters undone, as one row-major RGB or RGBA buffer. */
function decode(png) {
  let offset = 8;
  let header;
  const parts = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = data;
    if (type === "IDAT") parts.push(data);
    offset += 12 + length;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (
    header[8] !== 8 ||
    (header[9] !== 2 && header[9] !== 6) ||
    header[12] !== 0
  ) {
    throw new Error(
      `unsupported PNG: depth ${header[8]}, colour ${header[9]}, interlace ${header[12]}`
    );
  }
  const bpp = header[9] === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? pixels[y * stride + i - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const corner = i >= bpp && y > 0 ? pixels[(y - 1) * stride + i - bpp] : 0;
      let value = raw[from + i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, corner);
      pixels[y * stride + i] = value & 255;
    }
  }
  return { width, height, bpp, pixels };
}

const rgbOf = (bucket) =>
  [(bucket >> 10) & 31, (bucket >> 5) & 31, bucket & 31].map((v) =>
    Math.round((v * 255) / 31)
  );

/**
 * 256 colours for these pixels, from 5-bit buckets.
 *
 * Three quarters go to the commonest buckets, which is the fog ramp and the panels.
 * Popularity alone loses the accents: the signal pink is a badge border and one
 * selected roof, a few hundred pixels in a city of fog, and dropping it turns the
 * findings count orange. So the rest of the palette goes to whichever buckets sit
 * farthest from what is already in it, which is what keeps a small pink thing pink.
 */
function palette(pixels, bpp) {
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += bpp) {
    const bucket =
      ((pixels[i] >> 3) << 10) |
      ((pixels[i + 1] >> 3) << 5) |
      (pixels[i + 2] >> 3);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const chosen = ranked.slice(0, 192).map(([bucket]) => rgbOf(bucket));
  // A bucket under 20 pixels is an antialiased edge, not a colour worth a slot.
  const rest = ranked
    .slice(192)
    .filter(([, n]) => n >= 20)
    .map(([bucket]) => rgbOf(bucket));
  const distance = (a, b) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const far = rest.map((colour) =>
    Math.min(...chosen.map((c) => distance(c, colour)))
  );

  while (chosen.length < 256 && rest.length > 0) {
    let pick = 0;
    for (let i = 1; i < rest.length; i++) if (far[i] > far[pick]) pick = i;
    const [colour] = rest.splice(pick, 1);
    far.splice(pick, 1);
    chosen.push(colour);
    for (let i = 0; i < rest.length; i++)
      far[i] = Math.min(far[i], distance(colour, rest[i]));
  }
  return chosen;
}

/** A 24-bit PNG in, a 256-colour indexed PNG out. */
export function quantise(png) {
  const { width, height, bpp, pixels } = decode(png);
  const colours = palette(pixels, bpp);
  // One nearest-colour search per 5-bit bucket rather than per pixel: about 1700
  // searches on these shots instead of 1.6 million.
  const cache = new Map();
  const indexOf = (r, g, b) => {
    const bucket = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let hit = cache.get(bucket);
    if (hit === undefined) {
      let best = 0;
      let least = Number.POSITIVE_INFINITY;
      for (let i = 0; i < colours.length; i++) {
        const [cr, cg, cb] = colours[i];
        const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
        if (d < least) {
          least = d;
          best = i;
        }
      }
      hit = best;
      cache.set(bucket, hit);
    }
    return hit;
  };

  // Filter 0 on every row: one byte per pixel of palette indices has no gradient
  // for the other filters to subtract away, and they cost more than they save.
  const rows = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      rows[y * (width + 1) + 1 + x] = indexOf(
        pixels[i],
        pixels[i + 1],
        pixels[i + 2]
      );
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // colour type: indexed
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from(colours.flat())),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
