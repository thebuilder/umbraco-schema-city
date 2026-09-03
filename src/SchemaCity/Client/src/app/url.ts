// The three things about the view worth putting in a link: which type is open,
// whether it is focused, and which layers are on. Pure: no DOM, no React.
//
// The host owns the address bar. The harness lets the app write its own query
// string, and the workspace wrapper takes the same state through onStateChange
// and mirrors it into the backoffice route instead.
import { DEFAULT_LAYERS, LAYERS, type Layer } from "./scene/layers";

export type UrlState = {
  /** Alias of the type the view is about, or null when nothing is selected. */
  type: string | null;
  focus: boolean;
  layers: Layer[];
};

/**
 * `?type=article&focus=1&layers=structure,blocks`. An alias the schema does not
 * have is dropped rather than selecting nothing, because a link that outlived a
 * rename should still show the city.
 */
export function parseUrl(search: string, aliases: Iterable<string>): UrlState {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const known = type !== null && new Set(aliases).has(type) ? type : null;
  const layers = params.get("layers");

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
  };
}

export function serialiseUrl(state: UrlState): string {
  const parts: string[] = [];
  if (state.type) parts.push(`type=${encodeURIComponent(state.type)}`);
  if (state.type && state.focus) parts.push("focus=1");
  // Always written, so that turning every layer off survives a reload.
  parts.push(`layers=${state.layers.join(",")}`);
  return `?${parts.join("&")}`;
}
