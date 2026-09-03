// The world the city sits in: how far the ground reads before it fades, how far the
// orthographic camera may zoom before that fade could come into view, and the shader
// that draws the grid. Pure: no three.js, no React. Scene.tsx draws it.
//
// Borrowed from fsn's scene.ts. Background and fog take the same void colour, so the
// far ground dissolves instead of ending in a horizon ring, and the grid comes from
// world position rather than from the geometry, so one plane can be re-centred on the
// camera every frame without the lines appearing to slide.

/**
 * One grid square is six world units. It read as the street the layout left between
 * two ranks until that street grew to nine, and it is a ruler under the islands now
 * rather than their street plan.
 */
const MINOR_SPACING = 6;
const MAJOR_SPACING = 30;

/** A screen-vertical world unit lays over sqrt(3) of ground at a true isometric angle. */
const GROUND_STRETCH = Math.sqrt(3);

/** The smallest span `citySpan` ever returns, so the smallest the camera ever frames. */
const MIN_SPAN = 4;

/**
 * Where the grid fades, in world units from the camera's target. A city `width` by
 * `depth` reaches at most `span * 0.71` from its own centre, so the whole of it sits
 * inside `fadeNear` and draws at full strength. The plane is square and centred on
 * the target, so its half width has to clear `fadeFar` on the diagonal as well.
 */
export function stageMetrics(span: number): { fadeNear: number; fadeFar: number; plane: number } {
  const fadeFar = span * 6;
  return { fadeNear: span * 1.2, fadeFar, plane: fadeFar * 2.2 };
}

/**
 * Half the ground diagonal an orthographic camera can see. Its `zoom` is its pixels
 * per world unit, so it sees `width / zoom` by `height / zoom` world units, and the
 * isometric angle lays the vertical one over `sqrt(3)` times as much ground.
 */
export function groundReach(zoom: number, size: { width: number; height: number }): number {
  return Math.hypot(size.width, size.height * GROUND_STRETCH) / (2 * zoom);
}

/**
 * The zoom range the orbit controls allow. Zooming out stops where the corner of the
 * ground the camera sees reaches the end of the fade, which is the only way an edge
 * of the grid could ever show. Zooming in stops where the smallest city the camera
 * frames would fill the shorter side of the viewport, which is also the framing zoom
 * of a schema with one type in it.
 */
export function zoomRange(
  span: number,
  size: { width: number; height: number },
): { minZoom: number; maxZoom: number } {
  return {
    minZoom: groundReach(1, size) / stageMetrics(span).fadeFar,
    maxZoom: Math.min(size.width, size.height) / MIN_SPAN,
  };
}

/**
 * How far fog reaches, in the view depth three measures it by. It does work under an
 * orthographic camera, which is not obvious: fog reads `-mvPosition.z`, a view-space
 * depth that no projection touches. It needs no zoom term for the same reason, since
 * ortho zoom moves no camera and so changes nothing's depth.
 *
 * The camera holds its target `span` units away and the isometric angle puts the far
 * corner of a square city at `span * 1.58`, so fog starting at `span * 1.8` leaves the
 * whole city crisp at every zoom and only reaches ground well past it.
 */
export function fogRange(span: number): { near: number; far: number } {
  return { near: span * 1.8, far: span * 5 };
}

/**
 * How many CSS pixels one world unit covers, for either camera.
 *
 * An orthographic camera's `zoom` is exactly that number, whatever is being looked
 * at. A perspective camera's answer depends on how far away the thing is, so the
 * Explore mode has to pass the distance to the point it is asking about. Everything
 * that culls by on-screen size goes through here rather than reading `zoom`.
 */
export function pixelsPerUnit(
  camera: { isOrthographicCamera?: boolean; zoom: number; fov?: number },
  viewportHeight: number,
  distance: number,
): number {
  if (camera.isOrthographicCamera) return camera.zoom;
  const halfFov = (((camera.fov ?? 50) * Math.PI) / 180) / 2;
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
): "none" | "snap" | "fly" {
  if (last === null) return "snap";
  if (last.bounds !== next.bounds || last.reframe !== next.reframe) return "fly";
  // The orbit controls arrive one render after the first framing, and the target
  // they were created with is the origin, so that framing has to be applied again.
  return last.controls === next.controls ? "none" : "snap";
}

/** Cap height of a district's name printed on its island, in world units. */
export const STAMP_CAP = 3;

/**
 * Ground between the island's north and west edges and the name printed on it. The
 * padding around a district is 3 units, so a 3 unit cap set in from the corner runs
 * about half a unit past the padding, onto ground the outermost building's own row
 * leaves empty either side of it.
 */
const STAMP_INSET = 0.5;

/**
 * The shallowest angle the stamp corrects for. Past it the correction runs away, and
 * a name stretched to five times its cap covers the district it names.
 */
const STAMP_MIN_SINE = 0.2;

/**
 * Where a district's name lies on its island, how big the quad is and which way it
 * faces, in world units. `island` is the district's box with its padding already
 * added, `aspect` is the rasterised name's width over its cap height, and `view` is
 * the camera's ground direction with how high above the ground it stands.
 *
 * The name still prints in the north-west margin the layout leaves, but it is turned
 * to face the camera rather than lying along the island's north edge. Printed along
 * the edge it came out of the isometric projection as a cramped 30 degree diagonal,
 * near enough vertical for a long name. Turned, its baseline is square to the view
 * and it reads horizontally at every azimuth, so the correction is a yaw about its
 * own vertical axis rather than a billboard: it stays printed on the ground.
 *
 * The height is divided by the sine of the elevation, because ground lying that far
 * from square to the view loses exactly that much of its depth on screen, so a three
 * unit cap reads as three units. `spin` is the angle to turn the flat quad by, around
 * the world's vertical.
 *
 * A stamp that will not fit in the margin at its turned size shrinks until it does,
 * which is what a district of two types would otherwise hang over the void.
 */
export function districtStamp(
  island: { minX: number; maxX: number; minZ: number; maxZ: number },
  aspect: number,
  view: { forward: { x: number; z: number }; elevation: number },
  cap = STAMP_CAP,
): { x: number; z: number; width: number; height: number; spin: number } {
  const across = island.maxX - island.minX - STAMP_INSET * 2;
  const down = island.maxZ - island.minZ - STAMP_INSET * 2;
  const shorter = Math.min(across, down);
  let height = Math.min(
    cap / Math.max(Math.sin(view.elevation), STAMP_MIN_SINE),
    shorter / 2,
  );
  let width = height * aspect;

  // The baseline runs along the screen's right, a quarter turn from the view
  // direction on the ground, and the name's own up runs away from the camera. The
  // quad is laid flat by a quarter turn about x, so this is the spin it takes first,
  // in its own plane.
  const spin = Math.atan2(-view.forward.x, -view.forward.z);
  const right = { x: -view.forward.z, z: view.forward.x };
  // Half the ground the turned quad covers along each axis, so the corner it is
  // tucked into holds it whichever way it is facing.
  // ponytail: an axis-aligned box around a turned quad, so a name at 45 degrees to
  // the island shrinks a little more than it strictly has to. Fitting the quad's own
  // corners against the rectangle is a clip test per corner and buys back a few
  // percent of cap height on the two smallest districts.
  let halfX = (Math.abs(right.x) * width + Math.abs(view.forward.x) * height) / 2;
  let halfZ = (Math.abs(right.z) * width + Math.abs(view.forward.z) * height) / 2;
  const fit = Math.min(1, across / (2 * halfX), down / (2 * halfZ));
  if (fit < 1) {
    width *= fit;
    height *= fit;
    halfX *= fit;
    halfZ *= fit;
  }
  return {
    x: island.minX + STAMP_INSET + halfX,
    z: island.minZ + STAMP_INSET + halfZ,
    width,
    height,
    spin,
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
 * fsn's grid shader, near enough verbatim. The lines come from world position, so
 * re-centring the plane does not move them, and dividing by `fwidth` keeps a line one
 * pixel wide however far away it is rather than aliasing into a moiré. The radial
 * fade is what lets the ground end without an edge.
 */
export const GRID_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uCentre;
  uniform vec3 uMinorColour;
  uniform vec3 uMajorColour;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying vec3 vWorld;
  layout(location = 0) out vec4 fragColour;

  float lines(vec2 point, float spacing) {
    vec2 coord = point / spacing;
    vec2 derivative = max(fwidth(coord), vec2(1e-5));
    vec2 toLine = abs(fract(coord - 0.5) - 0.5) / derivative;
    return 1.0 - min(min(toLine.x, toLine.y), 1.0);
  }

  void main() {
    float minor = lines(vWorld.xz, ${MINOR_SPACING.toFixed(1)});
    float major = lines(vWorld.xz, ${MAJOR_SPACING.toFixed(1)});
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, distance(vWorld.xz, uCentre));
    float alpha = max(minor * 0.3, major * 0.66) * fade;
    if (alpha < 0.002) discard;
    fragColour = vec4(mix(uMinorColour, uMajorColour, major), alpha);
  }
`;
