import { expect, test } from "vitest";
import {
  clearOfEdge,
  type Finger,
  FINGER_REACH,
  PRINT_MARGIN,
  RING_RADIUS,
} from "./board";
import {
  atmosphere,
  districtStamp,
  framingAction,
  framingStep,
  pixelsPerUnit,
  STAMP_BAND,
  STAMP_CAP,
  settlingResize,
  STAMP_MIN_CAP,
} from "./stage";

test("no part of the city is in fog, wherever the camera orbits over it", () => {
  // The farthest a city point can be from the camera is the camera's distance to
  // its target plus the city's own diagonal, when the target is on one corner.
  for (const span of [4, 12, 87, 400]) {
    for (const distance of [2, span, span * 3]) {
      expect(atmosphere(span, distance).near).toBeGreaterThan(
        distance + span * Math.SQRT2
      );
    }
  }
});

test("no part of the city is in fog with the orbit point raised over it", () => {
  // A raised orbit point puts the ground that much further from the camera.
  for (const span of [4, 87, 400]) {
    for (const lift of [0, span / 2, span]) {
      const distance = span * 3;
      expect(atmosphere(span, distance, lift).near).toBeGreaterThan(
        distance + lift + span * Math.SQRT2
      );
    }
  }
});

test("the horizon moves out with the camera, so dollying out never finds an edge", () => {
  const close = atmosphere(87, 20);
  const far = atmosphere(87, 300);
  expect(far.near - close.near).toBeCloseTo(280);
  expect(far.far).toBeGreaterThan(close.far);
  expect(close.far).toBeGreaterThan(close.near * 2);
});

test("only a new framing moves the camera", () => {
  const bounds = { width: 40, depth: 87, centre: { x: 0, z: 0 } };
  const other = { ...bounds };
  const controls = {};
  const at = { bounds, controls, reframe: 0 };

  expect(framingAction(null, at)).toBe("snap");
  // The same bounds again is a re-render, a resize or a scroll, and the reader may
  // be mid-orbit through any of them.
  expect(framingAction(at, at)).toBe("none");
  expect(framingAction({ ...at, controls: null }, at)).toBe("snap");
  expect(framingAction(at, { ...at, bounds: other })).toBe("fly");
  // Home asks for the city it is already looking at, so nothing but the count moves.
  expect(framingAction(at, { ...at, reframe: 1 })).toBe("fly");
  // The canvas settling just after a reframe, as entering presentation does.
  expect(framingAction(at, at, true)).toBe("fly");
});

test("a resize frames again only just after a reframe", () => {
  const state = { until: 0, view: null as string | null };
  expect(settlingResize(state, "small", false, 0)).toBe(false);
  // A resize with no reframe behind it keeps the reader's camera.
  expect(settlingResize(state, "large", false, 100)).toBe(false);
  // The reframe itself is not a resize; the size it settles on next is.
  expect(settlingResize(state, "large", true, 200)).toBe(false);
  expect(settlingResize(state, "full", false, 900)).toBe(true);
  expect(settlingResize(state, "back", false, 5000)).toBe(false);
});

test("a world unit at twice the distance is half the size on screen", () => {
  const near = pixelsPerUnit(900, 100);
  expect(pixelsPerUnit(900, 200)).toBeCloseTo(near / 2);
  // At the 40 degree field of view, 100 units away fills 900 pixels with 72.8 units.
  expect(900 / near).toBeCloseTo(2 * 100 * Math.tan((20 * Math.PI) / 180));
});

/** A stamp's ground as a rectangle, or a test failure when there is none. */
function stampOf(
  island: { minX: number; maxX: number; minZ: number; maxZ: number },
  aspect: number
) {
  const stamp = districtStamp(island, aspect);
  if (!stamp) throw new Error("no stamp");
  return {
    ...stamp,
    minX: stamp.x - stamp.width / 2,
    maxX: stamp.x + stamp.width / 2,
    minZ: stamp.z - stamp.height / 2,
    maxZ: stamp.z + stamp.height / 2,
  };
}

test("a district's name prints in the band along the south edge of its island", () => {
  // "PAGES" tracked out, rasterised: about seven cap heights wide.
  const island = { minX: -20, maxX: 40, minZ: -10, maxZ: 30 };
  const stamp = stampOf(island, 7);

  // A full cap height, with no correction for the angle it is seen at.
  expect(stamp.height).toBeCloseTo(STAMP_CAP);
  expect(stamp.width / stamp.height).toBeCloseTo(7);
  // Inset from the south and west edges by more than a hole ring's diameter.
  expect(stamp.minX - island.minX).toBeGreaterThan(RING_RADIUS * 2 + PRINT_MARGIN);
  expect(island.maxZ - stamp.maxZ).toBeGreaterThan(RING_RADIUS * 2 + PRINT_MARGIN);
  // And past a finger's reach, so a lane leaving by either edge never meets it.
  expect(stamp.minX - island.minX).toBeGreaterThan(FINGER_REACH + PRINT_MARGIN);
  // The whole of it inside the band, so no row can ever stand over a letter.
  expect(stamp.minZ).toBeGreaterThanOrEqual(island.maxZ - STAMP_BAND);
});

test("a district's name stays clear of every hole, every finger and the edge", () => {
  const island = { minX: 0, maxX: 30, minZ: 0, maxZ: 24 };
  // Fingers wherever a lane could leave by the edges the name lies along.
  const fingers: Finger[] = [];
  for (let at = 0; at <= 30; at += 0.5)
    fingers.push(
      { district: "d", side: "south", x: at, z: island.maxZ },
      { district: "d", side: "west", x: island.minX, z: Math.min(at, 24) },
      { district: "d", side: "east", x: island.maxX, z: Math.min(at, 24) }
    );
  // From a short name to one that has to shrink to fit its row.
  for (const aspect of [2, 7, 12, 30, 60]) {
    const stamp = districtStamp(island, aspect);
    if (!stamp) continue;
    expect(clearOfEdge(stampOf(island, aspect), island, fingers)).toBe(true);
  }
});

test("the band leaves half a street and a unit between the last row and the name", () => {
  const island = { minX: 0, maxX: 60, minZ: 0, maxZ: 40 };
  const stamp = stampOf(island, 7);
  const lastRowEdge = island.maxZ - STAMP_BAND;
  expect(stamp.minZ - lastRowEdge).toBeCloseTo(3.5);
});

test("a name too wide for its island shrinks instead of running over a hole", () => {
  const island = { minX: 0, maxX: 20, minZ: 0, maxZ: 14 };
  const stamp = stampOf(island, 7);

  expect(stamp.height).toBeLessThan(STAMP_CAP);
  // It ends as far in from the east edge as it starts from the west.
  expect(island.maxX - stamp.maxX).toBeCloseTo(stamp.minX - island.minX);
  expect(stamp.minZ).toBeGreaterThanOrEqual(island.maxZ - STAMP_BAND);
  // Cap height and width shrink together, so the letters keep their shape.
  expect(stamp.width / stamp.height).toBeCloseTo(7);
});

test("a name that would shrink past the smallest cap is left off its board", () => {
  const island = { minX: 0, maxX: 10, minZ: 0, maxZ: 14 };
  expect(districtStamp(island, 30)).toBeNull();
  expect(stampOf(island, 2).height).toBeGreaterThanOrEqual(STAMP_MIN_CAP);
});

test("the camera rig snaps, flies, restores or plays the shot as the state asks", () => {
  const base = {
    action: "snap" as const,
    first: true,
    flying: false,
    reducedMotion: false,
    restorable: false,
    introSeen: () => false,
  };
  // The first framing in a browser plays the establishing shot, later ones snap.
  expect(framingStep(base)).toBe("intro");
  expect(framingStep({ ...base, introSeen: () => true })).toBe("place");
  // Back from a 2D view to the same framing: the pose, without a shot.
  expect(framingStep({ ...base, restorable: true })).toBe("restore");
  // The controls arriving: placed again, unless a flight is under way.
  expect(framingStep({ ...base, first: false })).toBe("place");
  expect(framingStep({ ...base, first: false, flying: true })).toBe("none");
  // A new framing flies, or lands at once under reduced motion.
  const fly = { ...base, action: "fly" as const, first: false };
  expect(framingStep(fly)).toBe("fly");
  expect(framingStep({ ...fly, reducedMotion: true })).toBe("place");
  expect(framingStep({ ...base, reducedMotion: true })).toBe("place");
  expect(framingStep({ ...base, action: "none" })).toBe("none");
});

test("the establishing shot is only marked seen when it would play", () => {
  let asked = 0;
  const introSeen = () => {
    asked += 1;
    return true;
  };
  const state = {
    action: "fly" as const,
    first: false,
    flying: false,
    reducedMotion: false,
    restorable: false,
    introSeen,
  };
  framingStep(state);
  framingStep({ ...state, reducedMotion: true });
  framingStep({ ...state, action: "snap", first: true, restorable: true });
  expect(asked).toBe(0);
  framingStep({ ...state, action: "snap", first: true });
  expect(asked).toBe(1);
});
