// The canvas renders on demand rather than every frame, so a still city costs
// nothing. Two rules keep it drawing whenever it has something new to show: every
// render of the scene asks for one frame, and anything that moves asks for the next
// frame for as long as it is moving. The orbit controls ask for their own on every
// change, the damping glide included.
import { type RootState, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

/** One frame at 60 Hz, the step an animation takes on the frame it starts on. */
const FIRST_STEP = 1 / 60;

/**
 * The step an animation takes this frame. The first frame after a still spell
 * hands back the whole spell as its delta, and an animation starting on it would
 * jump as far as the city sat still.
 */
export const stepFor = (delta: number, wasMoving: boolean): number =>
  wasMoving ? delta : Math.min(delta, FIRST_STEP);

/**
 * `useFrame` for something that moves: `step` says whether it is still moving, and
 * while it is, the next frame is asked for.
 */
export function useAnimationFrame(
  step: (state: RootState, delta: number) => boolean
): void {
  const moving = useRef(false);
  useFrame((state, delta) => {
    moving.current = step(state, stepFor(delta, moving.current));
    if (moving.current) state.invalidate();
  });
}

/**
 * One frame after every render of the scene. New props, and the effects that write
 * colours and matrices straight into the meshes, change what the canvas shows
 * without a three prop changing, which is all the canvas itself redraws for.
 */
export function RedrawOnRender(): null {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate());
  return null;
}
