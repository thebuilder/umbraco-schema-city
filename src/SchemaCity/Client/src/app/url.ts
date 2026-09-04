// What about the view is worth putting in a link: which type is open, whether it
// is focused, which layers are on and which usage lens is running. Pure: no DOM,
// no React.
//
// The host owns the address bar. The harness lets the app write its own query
// string, and the workspace wrapper takes the same state through onStateChange
// and mirrors it into the backoffice route instead.

import { DEFAULT_LAYERS, LAYERS, type Layer } from "./scene/layers";
import { LENSES, type Lens } from "./scene/lens";

/**
 * Which view is on screen. `city` is the isometric map, `explore` is the same city
 * under a free perspective camera, and `list` is the table that replaces the canvas.
 * One value rather than a flag each, because the list has no camera and the camera
 * has no table.
 */
export type View = "city" | "explore" | "list";

const VIEWS: readonly View[] = ["city", "explore", "list"];

export type UrlState = {
  /** Alias of the type the view is about, or null when nothing is selected. */
  type: string | null;
  focus: boolean;
  layers: Layer[];
  lens: Lens;
  view: View;
};

/**
 * `?type=article&focus=1&layers=structure,blocks&lens=count`. An alias the schema does not
 * have is dropped rather than selecting nothing, because a link that outlived a
 * rename should still show the city.
 */
export function parseUrl(search: string, aliases: Iterable<string>): UrlState {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const known = type !== null && new Set(aliases).has(type) ? type : null;
  const layers = params.get("layers");
  const lens = params.get("lens");

  return {
    type: known,
    // Focus with nothing to focus on is not a state the app can be in.
    focus: known !== null && params.get("focus") === "1",
    // Filtering the layer list rather than the parameter drops unknown names and
    // repeats, and puts what is left in toolbar order.
    layers:
      layers === null
        ? [...DEFAULT_LAYERS]
        : LAYERS.filter((layer) => layers.split(",").includes(layer)),
    // A lens the app does not have, and a link written before the usage report
    // existed, both read as no lens rather than as an error.
    lens: LENSES.find((candidate) => candidate === lens) ?? "none",
    // A view name the app does not have reads as the city, the same way an unknown
    // lens reads as no lens.
    view: VIEWS.find((candidate) => candidate === params.get("view")) ?? "city",
  };
}

/**
 * The address to write, or null when the app must keep its hands off the address bar.
 *
 * Umbraco's router-slot patches `history.replaceState` to announce a route change, and a
 * router that is part way through loading a page cancels that navigation the moment it
 * hears one. So once "Open in editor" has pushed the editor route, one more write from
 * here both puts our query on Umbraco's path and kills the navigation it started. The
 * pathname the app mounted on is the whole test: the push moves it before this ever runs.
 */
export function urlToWrite(
  state: UrlState,
  mountedAt: string,
  pathname: string
): string | null {
  return pathname === mountedAt ? pathname + serialiseUrl(state) : null;
}

export function serialiseUrl(state: UrlState): string {
  const parts: string[] = [];
  if (state.type) parts.push(`type=${encodeURIComponent(state.type)}`);
  if (state.type && state.focus) parts.push("focus=1");
  // Always written, so that turning every layer off survives a reload.
  parts.push(`layers=${state.layers.join(",")}`);
  if (state.lens !== "none") parts.push(`lens=${state.lens}`);
  if (state.view !== "city") parts.push(`view=${state.view}`);
  return `?${parts.join("&")}`;
}
