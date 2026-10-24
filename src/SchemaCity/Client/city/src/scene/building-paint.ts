// The colour of every part of a building: what the selection, the hover, the lens and
// the fade each do to it. Kept apart from the meshes so the rules can be tested.

import type { DistrictKind } from "@schema-city/core/layout/city";
import type { FloorCellKind } from "@schema-city/core/scene/buildings";
import type { LensScale, Ramp } from "@schema-city/core/scene/lens";
import * as THREE from "three";

/** The theme colours the buildings read. Scene's palette has these and more. */
export type BuildingPalette = {
  phosphor: string;
  dim: string;
  signal: string;
  amber: string;
  azure: string;
  background: string;
  separator: string;
};

export type PartKind = FloorCellKind | "plaza";

export type BuildingColours = ReturnType<typeof buildingColours>;

export type PaintState = {
  selected: string | null;
  hovered: string | null;
  /** The buildings left lit, or null when nothing is faded. */
  neighbours: Set<string> | null;
  /** The hovered building and the ones its lines reach, or null with no hover. */
  hoveredNeighbours?: Set<string> | null;
  /** Each building's colour on the lens's ramp, empty with no lens on. */
  lens: Map<string, THREE.Color>;
  lensOn: boolean;
  district: Map<string, DistrictKind>;
  /** How far focus mode has pressed each building flat, 0 to 1. */
  flatten: Map<string, number>;
};

const HOVER_BRIGHTEN = 1.4;
/**
 * A building the hovered one connects to, lit a step below the hovered one, so the
 * far end of each drawn line reads as a building rather than a guess.
 */
const HOVER_NEIGHBOUR_BRIGHTEN = 1.25;
/**
 * How far the rest of the city recedes while a hover draws its lines and nothing is
 * selected: well short of the selection's fade, since a hover comes and goes with
 * the pointer and the city should not blink under it.
 */
const HOVER_FADE_MIX = 0.6;
/** How far a faded building's colour moves toward the void, approximating 20% opacity. */
const FADE_MIX = 0.8;
/** The same, for a building focus mode has pressed flat: about 12% opacity. */
const PLATE_MIX = 0.88;

export function buildingColours(palette: BuildingPalette) {
  const phosphor = new THREE.Color(palette.phosphor);
  const dim = new THREE.Color(palette.dim);
  const background = new THREE.Color(palette.background);
  const separator = new THREE.Color(palette.separator);
  const marker = phosphor.clone().lerp(new THREE.Color("#ffffff"), 0.6);
  return {
    phosphor,
    dim,
    background,
    marker,
    signal: new THREE.Color(palette.signal),
    amber: new THREE.Color(palette.amber),
    azure: new THREE.Color(palette.azure),
    // The parts with a colour of their own, whatever the type is: the board a
    // component sits on, the dark inside that shows between slabs, the unlit lid,
    // the pins, the tab boards and the roof dots.
    parts: {
      plinth: separator.clone().lerp(dim, 0.3),
      core: separator.clone().lerp(background, 0.5),
      lid: separator.clone().lerp(dim, 0.35),
      pin: dim,
      separator: dim,
      marker,
    } as Partial<Record<PartKind, THREE.Color>>,
  };
}

/**
 * The change layer's four steps. Added is azure and a type's own edit amber, the
 * colours the compare rings always had. A side effect is the same amber pushed most
 * of the way into the background, so it reads as the quieter echo of a cause, and
 * an unchanged type is phosphor-dim pushed as far, out of the way.
 */
function changeColour(t: number, colours: BuildingColours): THREE.Color {
  if (t >= 1) return colours.azure.clone();
  if (t >= 0.75) return colours.amber.clone();
  if (t >= 0.5) return colours.amber.clone().lerp(colours.background, 0.72);
  return colours.dim.clone().lerp(colours.background, 0.7);
}

/**
 * Where one building lands on the lens's ramp. Amber to azure both ways, with
 * phosphor-dim as the diverging middle and the unused lens's quiet end, because
 * phosphor against signal is the pair colour-vision deficiency ruins.
 */
function rampColour(
  ramp: Ramp,
  t: number,
  colours: BuildingColours
): THREE.Color {
  if (ramp === "binary")
    return (t >= 0.5 ? colours.signal : colours.dim).clone();
  if (ramp === "change") return changeColour(t, colours);
  if (ramp === "sequential")
    return colours.amber.clone().lerp(colours.azure, t);
  return t < 0.5
    ? colours.amber.clone().lerp(colours.dim, t * 2)
    : colours.dim.clone().lerp(colours.azure, (t - 0.5) * 2);
}

/**
 * The lens colour of every building the lens has a number for. The ones it says
 * nothing about are Element Types, which have no content of their own.
 */
export function lensColours(
  scale: LensScale | null,
  colours: BuildingColours
): Map<string, THREE.Color> {
  const out = new Map<string, THREE.Color>();
  for (const [id, t] of scale?.t ?? [])
    out.set(id, rampColour(scale?.ramp ?? "sequential", t, colours));
  return out;
}

/**
 * A page takes its colour from the district it stands in: phosphor in a structure
 * district, phosphor-dim in a composition or mixed one, amber in an element one.
 */
function districtColour(
  district: DistrictKind | undefined,
  colours: BuildingColours
): THREE.Color {
  if (district === "structure") return colours.phosphor;
  return district === "elements" ? colours.amber : colours.dim;
}

/**
 * The slabs, the element block and the lit lid say what the type is, so they take
 * the selection and the lens. Element Types are amber and the composed shell azure,
 * the colour of the composition traces, wherever they stand. Under a lens an Element
 * Type goes phosphor-dim: amber is the zero end of the ramp, and an amber district
 * next to it would read as the emptiest place in the city. The root plaza takes the
 * selection but never the lens.
 */
function bodyColour(
  kind: PartKind,
  id: string,
  colours: BuildingColours,
  state: PaintState
): THREE.Color {
  if (id === state.selected) return colours.signal;
  if (kind === "plaza") return colours.dim;
  const lens = state.lens.get(id);
  if (lens) return lens;
  if (kind === "composed") return colours.azure;
  if (kind === "element") return state.lensOn ? colours.dim : colours.amber;
  return districtColour(state.district.get(id), colours);
}

/**
 * What a hover does to a building other than the hovered one: lights it when a line
 * of the hover reaches it, and otherwise lets it recede, unless a selection or a
 * focus already decides what is faded.
 */
function hoverPaint(
  id: string,
  colours: BuildingColours,
  state: PaintState,
  out: THREE.Color
) {
  const reached = state.hoveredNeighbours;
  if (!reached) return;
  if (reached.has(id)) out.multiplyScalar(HOVER_NEIGHBOUR_BRIGHTEN);
  else if (!state.neighbours) out.lerp(colours.background, HOVER_FADE_MIX);
}

/** One part's colour, written into `out` so a repaint allocates nothing per part. */
export function paintPart(
  kind: PartKind,
  id: string,
  colours: BuildingColours,
  state: PaintState,
  out: THREE.Color
): THREE.Color {
  out.copy(colours.parts[kind] ?? bodyColour(kind, id, colours, state));
  // A lit lid is the page's own colour turned toward white: it renders.
  if (kind === "litLid") out.lerp(colours.marker, 0.1);
  if (id === state.hovered) out.multiplyScalar(HOVER_BRIGHTEN);
  else hoverPaint(id, colours, state, out);
  // A building pressed flat is further out of the way than a merely faded one, so
  // the focus layout stands on a map rather than in a crowd.
  if (state.neighbours && !state.neighbours.has(id))
    out.lerp(
      colours.background,
      FADE_MIX + (PLATE_MIX - FADE_MIX) * (state.flatten.get(id) ?? 0)
    );
  return out;
}
