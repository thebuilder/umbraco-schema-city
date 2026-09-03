// Umbraco's own icons, turned into something the scene can put on a roof. The
// wrappers hand the app one SVG string per icon name, read from the backoffice icon
// registry; here each name and colour is rasterised once into a canvas the scene
// wraps in a texture. Pure of three.js and React; it does use a canvas and an Image,
// because that is the only way to turn SVG into pixels.
//
// The SVG is drawn through an Image, which is the sandboxed path: script and
// external references inside an SVG never run when it is loaded as an image.

/** Pixels per side. One roof icon is 40 px on screen at the framing zoom. */
const ICON_PX = 128;

/** The Umbraco colour suffixes that are not CSS colour keywords on their own. */
const COMPOUND: Record<string, string> = {
  "blue-grey": "#607d8b",
  "deep-orange": "#ff5722",
  "deep-purple": "#673ab7",
  "light-blue": "#03a9f4",
  "light-green": "#8bc34a",
};

/**
 * The colour to paint an icon in: the type's own `color-…` suffix when it has one
 * that a browser knows, and the fallback otherwise. The name is checked rather than
 * trusted, both because it goes into an SVG attribute and because an unknown colour
 * would paint nothing at all.
 */
export function iconColour(iconColor: string | null | undefined, fallback: string): string {
  const name = (iconColor ?? "").replace(/^color-/, "");
  const colour = COMPOUND[name] ?? name;
  if (!/^(?:[a-z]+|#[0-9a-f]{3,8})$/.test(colour)) return fallback;
  // CSS.supports is the browser's own list. Under vitest there is no CSS object and
  // the pattern above is the whole check.
  return typeof CSS === "undefined" || CSS.supports("color", colour) ? colour : fallback;
}

/**
 * The icon as the rasteriser gets it: sized, and painted in one colour. Umbraco's
 * icons are a mix of `currentColor` and no fill at all, and an SVG loaded as an
 * image has no CSS around it to inherit either from, so the colour is written onto
 * the root element and substituted for every `currentColor` inside it.
 */
export function paintedSvg(svg: string, colour: string): string {
  return svg
    .replace(/<svg\b[^>]*>/i, (root) => {
      // A root that already names a fill keeps it, because an outline icon says
      // fill="none" there and filling it in would paint a solid blob.
      const fill = /\sfill\s*=/i.test(root) ? "" : ` fill="${colour}"`;
      return root
        .replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, "")
        .replace(/^<svg/i, `<svg width="${ICON_PX}" height="${ICON_PX}"${fill}`);
    })
    .replace(/currentColor/g, colour);
}

/** One canvas per icon name and colour, kept for the life of the page. */
const rasters = new Map<string, Promise<HTMLCanvasElement>>();

/**
 * The icon rasterised to a square canvas, once per `key`. Rejects when the icon is
 * not something the browser can draw, which the scene turns into no icon at all.
 */
export function rasteriseIcon(key: string, svg: string, colour: string): Promise<HTMLCanvasElement> {
  const found = rasters.get(key);
  if (found) return found;

  const made = new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = ICON_PX;
      canvas.height = ICON_PX;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("no 2d context"));
        return;
      }
      context.drawImage(image, 0, 0, ICON_PX, ICON_PX);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error(`icon ${key} did not load`));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(paintedSvg(svg, colour))}`;
  });

  rasters.set(key, made);
  return made;
}

/**
 * The icon as a CSS mask value, for the panels. The colour then comes from the
 * element's own background, and the SVG never becomes markup in the document, so
 * an icon that arrived with a script or an event handler in it cannot run one.
 */
export function iconMask(svg: string): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}
