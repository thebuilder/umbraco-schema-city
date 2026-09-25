// The world the city sits in: how far the ground reads before it fades into the
// horizon, how big one world unit is on screen, and the shaders that draw the ground
// and the sky. Pure: no three.js, no React. Scene.tsx draws it.
//
// Borrowed from fsn's scene.ts. The fog, the ground's own fade and the sky below the
// horizon all end on one horizon colour, so the far ground dissolves instead of
// ending in a ring or an edge, and the grid comes from world position rather than
// from the geometry, so one plane can be re-centred on the camera every frame
// without the lines appearing to slide.
import { FLOOR_HEIGHT } from "./buildings";

/** Highest board surface; ground traces must sit above nested folder tints. */
export const FOLDER_TINT_HEIGHT = 0.02;

/**
 * One grid square is six world units. It read as the street the layout left between
 * two ranks until that street grew to nine, and it is a ruler under the islands now
 * rather than their street plan.
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
 */
export function atmosphere(
  span: number,
  distance: number
): { near: number; far: number } {
  const near = distance + span * 1.5;
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
  next: { bounds: B; controls: C; reframe: number }
): "none" | "snap" | "fly" {
  if (last === null) return "snap";
  if (last.bounds !== next.bounds || last.reframe !== next.reframe)
    return "fly";
  // The orbit controls arrive one render after the first framing, and the target
  // they were created with is the origin, so that framing has to be applied again.
  return last.controls === next.controls ? "none" : "snap";
}

/**
 * Cap height of a district's name printed on its island, in world units. At three it
 * rasterised to a 17 pixel cap once the whole city was framed, which is where a mono
 * face at this tracking starts to average into the slab.
 */
export const STAMP_CAP = 4;

/**
 * Ground between the name and the two island edges it sits near: the west edge it is
 * aligned to and the north edge above it.
 */
const STAMP_INSET = 0.5;

/**
 * Floors in the first row the band is cut to clear. Four covers every first row in
 * both fixtures; a taller building in that row still leans over the letters.
 */
const FIRST_ROW_FLOORS = 4;

/**
 * How much ground a building of height 1 hides behind itself. At the isometric angle
 * the point (0, 1, 0) draws where the ground point (-1, 0, -1) does, so a roof leans
 * sqrt(2) units up the island's diagonal, and the city orbits, so the whole of that
 * can fall along z.
 */
const LEAN_PER_UNIT = Math.SQRT2;
/** A full 9-unit outer street plus one unit of clearance below the title. */
const NORTH_STREET_RESERVE = 10;

/** Reserve enough ground below the title for both roads and projected rooftops. */
export const STAMP_BAND =
  STAMP_INSET +
  STAMP_CAP +
  Math.max(
    LEAN_PER_UNIT * FIRST_ROW_FLOORS * FLOOR_HEIGHT,
    NORTH_STREET_RESERVE
  );

/**
 * Where a district's name lies on its island and how big it is, in world units.
 * `island` is the district's box with its padding already added, and `aspect` is the
 * rasterised name's width over its cap height.
 *
 * The name is a fixed part of the city rather than a label: it lies flat along the
 * island's north edge, tucked into the north-west corner of the band the layout
 * holds clear, and it does not turn, grow or move with the camera. The isometric
 * projection makes a 30 degree diagonal of a line running east, so that is how the
 * name reads, and it stays where it was put while the city is orbited.
 *
 * Lying square to the island is what contains it: its footprint is its own width and
 * height, so the band holds all of it and no building can ever stand over a letter.
 * Turning it to face the camera read horizontally at every azimuth but swept a strip
 * at 45 degrees to the island that ran north over the street, where a building on
 * the island behind covered the end of a long name.
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
    z: island.minZ + STAMP_INSET + height / 2,
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
