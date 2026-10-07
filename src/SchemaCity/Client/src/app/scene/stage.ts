// The world the city sits in: how far the ground reads before it fades into the
// horizon, how big one world unit is on screen, and the shaders that draw the ground
// and the sky. Pure: no three.js, no React. Scene.tsx draws it.
//
// Borrowed from fsn's scene.ts. The fog, the ground's own fade and the sky below the
// horizon all end on one horizon colour, so the far ground dissolves instead of
// ending in a ring or an edge, and the grid comes from world position rather than
// from the geometry, so one plane can be re-centred on the camera every frame
// without the lines appearing to slide.

/** Highest board surface; ground traces must sit above nested folder tints. */
export const FOLDER_TINT_HEIGHT = 0.02;

/**
 * One grid square is six world units, the street the layout leaves between two
 * ranks, so the ruler under the islands matches their street plan.
 */
const MINOR_SPACING = 6;
const MAJOR_SPACING = 30;

/** Vertical field of view of the city camera, in degrees. */
export const CAMERA_FOV = 40;

/**
 * Where fog starts and where the world is gone, in world units from the camera, for
 * a camera `distance` from the point it orbits over a city whose longer side is
 * `span`.
 *
 * Measured from the camera rather than from the city, so dollying out pushes the
 * horizon back with it and the city never sinks into its own fog. No point of a
 * city is more than `span * 1.42` from another, so fog starting `span * 1.5` past
 * the orbit point leaves all of it crisp wherever the camera orbits over it. Three
 * times that is where the ground has become the horizon, which is also as far as
 * the camera needs to see.
 *
 * `lift` is how far the orbit point is above the ground. R raises it, and the city
 * is then that much further from the camera than the orbit point is, so the fog
 * starts that much further out too.
 */
export function atmosphere(
  span: number,
  distance: number,
  lift = 0
): { near: number; far: number } {
  const near = distance + Math.max(0, lift) + span * 1.5;
  return { near, far: near * 3 };
}

/**
 * How many CSS pixels one world unit covers at `distance` from the camera. Everything
 * that culls by on-screen size goes through here.
 */
export function pixelsPerUnit(
  viewportHeight: number,
  distance: number,
  fov = CAMERA_FOV
): number {
  const halfFov = (fov * Math.PI) / 360;
  return viewportHeight / (2 * Math.max(distance, 1e-6) * Math.tan(halfFov));
}

/**
 * What the camera rig should do when its framing effect runs again.
 *
 * The effect's inputs include the viewport, and the viewport is measured again on
 * every resize and on some scrolls, so most runs are about nothing the camera cares
 * about. Re-framing on those throws away the orbit, pan and zoom the reader is in
 * the middle of, which is the whole reason this decision is its own function:
 * only a new set of bounds or a bumped `reframe` moves the camera, and only the
 * first framing and the one that follows the controls arriving snap instead of
 * flying. `reframe` is how Home asks for the same city to be framed again.
 */
export function framingAction<B, C>(
  last: { bounds: B; controls: C; reframe: number } | null,
  next: { bounds: B; controls: C; reframe: number },
  /** The canvas settling on a new size just after a reframe, from `settlingResize`. */
  resized = false
): "none" | "snap" | "fly" {
  if (last === null) return "snap";
  if (last.bounds !== next.bounds || last.reframe !== next.reframe || resized)
    return "fly";
  // The orbit controls arrive one render after the first framing, and the target
  // they were created with is the origin, so that framing has to be applied again.
  return last.controls === next.controls ? "none" : "snap";
}

/**
 * How long after a reframe a change of canvas size frames again. Entering or leaving
 * presentation asks for a reframe and then resizes the canvas, once when the toolbar
 * goes and again when full screen lands, so the framing asked for is the one at the
 * size the canvas settles on.
 *
 * ponytail: a time window, not the end of the resize. A full-screen animation slower
 * than this lands on the last size it framed for; reading the fullscreenchange event
 * is the upgrade if that shows.
 */
const RESIZE_SETTLE_MS = 1500;

/**
 * Whether this run of the framing effect is the canvas changing size within
 * `RESIZE_SETTLE_MS` of a reframe. `state` is the rig's own record of the last view
 * it saw and when the window closes, updated in place; `view` changes identity only
 * when the size or the bounds do.
 */
export function settlingResize<V>(
  state: { until: number; view: V | null },
  view: V,
  asked: boolean,
  now: number
): boolean {
  const resized = state.view !== null && state.view !== view;
  state.view = view;
  if (asked) state.until = now + RESIZE_SETTLE_MS;
  return resized && now < state.until;
}

/**
 * What the camera rig does with a framing action, given the rest of its state:
 * nothing, put back the pose it was left in after a 2D view, place the camera on
 * the framing, play the establishing shot into it, or fly to it.
 *
 * Coming back from a 2D view to the framing it left is a restore, with no shot and
 * no flight. The controls arriving while a flight runs need nothing, since the
 * flight writes their target and hands them the camera when it lands. Reduced
 * motion places rather than flies. The first framing in a browser plays the
 * establishing shot, once: `introSeen` marks it seen, so it is only asked when the
 * shot would otherwise play.
 */
export function framingStep(state: {
  action: "none" | "snap" | "fly";
  first: boolean;
  flying: boolean;
  reducedMotion: boolean;
  restorable: boolean;
  introSeen: () => boolean;
}): "none" | "restore" | "place" | "intro" | "fly" {
  const { action, first } = state;
  if (action === "none") return "none";
  if (first && state.restorable) return "restore";
  if (action === "snap" && !first && state.flying) return "none";
  if (!state.reducedMotion && action === "fly") return "fly";
  if (state.reducedMotion || !first) return "place";
  return state.introSeen() ? "place" : "intro";
}

/**
 * Cap height of a district's name printed on its island, in world units. At three it
 * rasterised to a 17 pixel cap once the whole city was framed, which is where a mono
 * face at this tracking starts to average into the slab.
 */
export const STAMP_CAP = 4;

/**
 * Ground between the name and the two island edges it sits near: the west edge it is
 * aligned to and the south edge below it.
 */
const STAMP_INSET = 0.5;

/**
 * Ground between the name and the last row, which holds the outer street a road
 * takes out of that row: half of the layout's six-unit street plus half a unit.
 */
const STAMP_CLEARANCE = 3.5;

/**
 * Ground a district holds along its south edge for its name. South, because the
 * default camera looks from the south-east: a roof leans away from it, over the
 * ground north of the building, so the name needs no room for leaning roofs. On the
 * north edge it did, and that band was 14.5 units of empty plate on every island.
 */
export const STAMP_BAND = STAMP_INSET + STAMP_CAP + STAMP_CLEARANCE;

/**
 * Where a district's name lies on its island and how big it is, in world units.
 * `island` is the district's box with its padding already added, and `aspect` is the
 * rasterised name's width over its cap height.
 *
 * The name is a fixed part of the city rather than a label: it lies flat along the
 * island's south edge, tucked into the south-west corner of the band the layout
 * holds clear, and it does not turn, grow or move with the camera.
 *
 * Lying square to the island is what contains it: its footprint is its own width and
 * height, so the band holds all of it and no building can ever stand over a letter.
 *
 * A name wider than its island shrinks until it fits, which is what a district of two
 * types would otherwise hang over the void.
 */
export function districtStamp(
  island: { minX: number; maxX: number; minZ: number; maxZ: number },
  aspect: number,
  cap = STAMP_CAP
): { x: number; z: number; width: number; height: number } {
  const across = island.maxX - island.minX - STAMP_INSET * 2;
  let height = cap;
  let width = height * aspect;
  // Cap height and width shrink together, so the letters keep their shape.
  const fit = Math.min(1, across / width);
  width *= fit;
  height *= fit;
  return {
    x: island.minX + STAMP_INSET + width / 2,
    z: island.maxZ - STAMP_INSET - height / 2,
    width,
    height,
  };
}

export const GRID_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/**
 * fsn's grid shader, drawn over an opaque ground. The lines come from world
 * position, so re-centring the plane does not move them, and dividing by `fwidth`
 * keeps a line one pixel wide however far away it is rather than aliasing into a
 * moire.
 *
 * The ground takes the fog by its distance from the camera rather than by view
 * depth, so the plane's own edge, which is off to the side as often as ahead, is
 * always past the point where it has become the horizon. It also hazes over from a
 * few camera heights out, closer than the fog the islands get. Seen from low down,
 * everything past that is packed into the last degree or two above the horizon, and
 * without the haze the ground would stay dark right up to a thin bright seam there.
 *
 * The two chunks at the end are what every built-in material ends on. Without them
 * the fogged ground would skip the tone mapping the fogged islands get and stop
 * matching them at the horizon.
 */
export const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uMinorColour;
  uniform vec3 uMajorColour;
  uniform vec3 uHorizon;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;

  float lines(vec2 point, float spacing) {
    vec2 coord = point / spacing;
    vec2 derivative = max(fwidth(coord), vec2(1e-5));
    vec2 toLine = abs(fract(coord - 0.5) - 0.5) / derivative;
    float line = 1.0 - min(min(toLine.x, toLine.y), 1.0);
    // Squares only a few pixels across turn into a moire toward the horizon, so the
    // lines give way to the share of the ground they cover, the way a mipmap would.
    float cover = min(derivative.x + derivative.y, 1.0);
    return mix(line, cover, smoothstep(0.08, 0.3, max(derivative.x, derivative.y)));
  }

  void main() {
    float minor = lines(vWorld.xz, ${MINOR_SPACING.toFixed(1)});
    float major = lines(vWorld.xz, ${MAJOR_SPACING.toFixed(1)});
    float line = max(minor * 0.16, major * 0.4);
    vec3 colour = mix(uGround, mix(uMinorColour, uMajorColour, major), line);
    float haze = min(uFogNear, (cameraPosition.y - vWorld.y) * 6.0);
    float fog = smoothstep(haze, uFogFar, distance(vWorld, cameraPosition));
    gl_FragColor = vec4(mix(colour, uHorizon, fog), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The sky dome: dark at the zenith, lighter where it meets the ground, and exactly
 * the horizon colour at and below the horizon. The fog ends on that same colour, so
 * the ground, the islands and the sky run into one line with no ring. The falloff is
 * steep, so most of the sky stays close to the void the chrome is drawn on and the
 * light gathers in a band along the horizon.
 */
export const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDirection;

  void main() {
    float up = max(normalize(vDirection).y, 0.0);
    gl_FragColor = vec4(mix(uHorizon, uZenith, pow(up, 0.35)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
