"use client"

import { isCapturing } from "@thebuilder/deckard-core"
import { useSlideStepper } from "@thebuilder/deckard-core/components"
import { useEffect, useState } from "react"

/*
 * A beat is one thing happening on a slide: a command typed, a camera move. The
 * presenter's clicks drive the beats when slides.tsx gives the slide a
 * stepCount, and they play on a timer from the moment the slide mounts when it
 * does not. The slide works either way, so the order of beats is written once
 * and the decision about clicking stays with the run of show.
 *
 * `delays` is the timer for each beat after the first, in milliseconds since
 * the slide mounted. A screenshot or a PDF export lands on the last beat, since
 * a still of the first beat is a still of an empty prompt.
 */
export function useBeat(delays: readonly number[]): number {
  const stepper = useSlideStepper()
  const last = delays.length
  const stepped = (stepper?.stepCount ?? 0) > 1
  const [timed, setTimed] = useState(0)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (isCapturing()) {
      setCapturing(true)
      return
    }
    if (stepped) {
      return
    }
    const timers = delays.map((delay, index) =>
      window.setTimeout(() => setTimed(index + 1), delay)
    )
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
    // The delays are authored constants, so a new array identity is not a new
    // plan and does not restart the timers.
  }, [stepped])

  if (capturing) {
    return last
  }
  if (stepped) {
    return Math.min(stepper?.currentStep ?? 0, last)
  }
  return timed
}

/*
 * True for a screenshot, a PDF export, and a viewer who asked for less motion.
 * Each of those wants the end state of an animation rather than the animation.
 */
export function useStill(): boolean {
  const [still, setStill] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setStill(isCapturing() || query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return still
}
