"use client"

import { useEffect, useState } from "react"
import { useBeat, useStill } from "@/deck/parts/beats"
import { FsnScene, fsnTarget } from "@/deck/parts/fsn-scene"
import { Terminal } from "@/deck/parts/terminal"

/*
 * The control room, recreated rather than played. fsn is launched from a
 * shell, the tree boots up out of the floor and the camera circles it, the line
 * lands as a subtitle, and then the camera goes and finds the door locks.
 *
 * Beat 0 launches fsn, beat 1 is the line, beat 2 is the flight.
 */
const delays = [3800, 8500]

// Long enough for the command to finish typing before the tree appears.
const bootDelay = 1500

export function UnixSystem() {
  const beat = useBeat(delays)
  const still = useStill()
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    if (still) {
      setBooted(true)
      return
    }
    const timer = window.setTimeout(() => setBooted(true), bootDelay)
    return () => window.clearTimeout(timer)
  }, [still])

  const focus = beat >= 2

  return (
    <section className="relative h-full w-full overflow-hidden">
      <FsnScene
        className={
          booted
            ? "absolute inset-0 opacity-100 transition-opacity duration-1000"
            : "absolute inset-0 opacity-0"
        }
        focus={focus}
        still={still}
      />

      {/* The tube's scanlines ride over the picture as well as under it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "var(--slide-scanline)" }}
      />

      <div className="absolute top-[var(--slide-padding-block)] left-[var(--slide-padding-inline)] border border-[var(--slide-surface-border)] bg-[var(--slide-surface)] px-6 py-4">
        <Terminal
          beat={0}
          entries={[{ command: "fsn /usr/park" }]}
          idle={false}
          prompt="lex@control-room:~$"
          still={still}
        />
        <p
          className="font-mono text-[length:var(--slide-support-size)] text-muted-foreground leading-[1.5] transition-opacity duration-500"
          style={{ opacity: booted ? 1 : 0 }}
        >
          {"location: "}
          <span
            className={
              focus ? "text-[color:var(--slide-signal)]" : "text-foreground"
            }
          >
            {focus ? fsnTarget : "/usr/park"}
          </span>
        </p>
      </div>

      <p
        className="absolute inset-x-0 bottom-[calc(var(--slide-footer-space)+3rem)] text-center font-bold text-[length:var(--slide-subheading-size)] text-foreground transition-opacity duration-300"
        style={{
          opacity: beat >= 1 ? 1 : 0,
          textShadow: "0 0 0.4em var(--background), var(--slide-halo)",
        }}
      >
        {"It's a UNIX system! I know this!"}
      </p>
    </section>
  )
}
