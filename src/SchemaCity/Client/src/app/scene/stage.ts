// The world the city sits in: how far the ground reads before it fades, how far the
// orthographic camera may zoom before that fade could come into view, and the shader
// that draws the grid. Pure: no three.js, no React. Scene.tsx draws it.
//
// Borrowed from fsn's scene.ts. Background and fog take the same void colour, so the
// far ground dissolves instead of ending in a horizon ring, and the grid comes from
// world position rather than from the geometry, so one plane can be re-centred on the
// camera every frame without the lines appearing to slide.

/** One grid square is the 6-unit street the layout leaves between ranks. */
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
