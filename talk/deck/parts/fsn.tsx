"use client"

import { useIsPresenterPreview } from "@thebuilder/deckard-core/components"
import { useEffect, useState } from "react"
import { useStill } from "@/deck/parts/beats"
import { FsnScene } from "@/deck/parts/fsn-scene"

const site = "https://fsn.thebuilder.dk/"

/*
 * The rebuild, live. The site runs in a frame filling the slide, so it can be
 * flown on stage. Three cases get the deck's own fsn scene instead: no
 * network, the presenter console's preview (one live copy of the site is
 * enough), and a screenshot, which should not depend on the venue's wifi.
 *
 * Clicking into the frame hands it the keyboard, so the arrow keys fly the
 * camera rather than step the deck. Click the address strip to hand them back.
 */
export function Fsn() {
  const preview = useIsPresenterPreview()
  const still = useStill()
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  const live = online && !preview && !still

  return (
    <section className="relative flex h-full w-full flex-col">
      <div
        className="flex shrink-0 items-center gap-4 border-[var(--slide-rule)] border-b bg-[var(--slide-surface)] px-[var(--slide-padding-inline)] py-3 font-mono text-[length:var(--slide-support-size)]"
        data-step-ignore-click="true"
      >
        <span
          aria-hidden
          className="size-[0.6em] bg-primary"
          style={{
            boxShadow: "var(--slide-halo)",
            opacity: live ? 1 : 0.4,
          }}
        />
        <span className="text-foreground">{site}</span>
        <span className="ml-auto text-muted-foreground">
          {live ? "live" : "local replay"}
        </span>
      </div>
      {/* Stops above the status bar, so the site's own controls along its
          bottom edge stay reachable. */}
      <div className="relative mb-[var(--slide-footer-space)] min-h-0 flex-1">
        {live ? (
          <iframe
            allow="fullscreen; gamepad; xr-spatial-tracking"
            className="absolute inset-0 h-full w-full border-0 bg-background"
            src={site}
            title="fsn.thebuilder.dk"
          />
        ) : (
          <FsnScene className="absolute inset-0" still={still} />
        )}
      </div>
    </section>
  )
}
