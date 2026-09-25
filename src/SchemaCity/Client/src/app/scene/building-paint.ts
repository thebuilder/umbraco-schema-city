// The colour of every part of a building: what the selection, the hover, the lens and
// the fade each do to it. Kept apart from the meshes so the rules can be tested.
import * as THREE from "three";
import type { DistrictKind } from "../layout/city";
import type { FloorCellKind } from "./buildings";
import type { LensScale, Ramp } from "./lens";

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
  /** Each building's colour on the lens's ramp, empty with no lens on. */
  lens: Map<string, THREE.Color>;
  lensOn: boolean;
  district: Map<string, DistrictKind>;
  /** How far focus mode has pressed each building flat, 0 to 1. */
  flatten: Map<string, number>;
};

const HOVER_BRIGHTEN = 1.4;
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
  // A building pressed flat is further out of the way than a merely faded one, so
  // the focus layout stands on a map rather than in a crowd.
  if (state.neighbours && !state.neighbours.has(id))
    out.lerp(
      colours.background,
      FADE_MIX + (PLATE_MIX - FADE_MIX) * (state.flatten.get(id) ?? 0)
    );
  return out;
}
