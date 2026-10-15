"use client"

import { type RefObject, useEffect, useState } from "react"
import { Color } from "three"

/*
 * three.js cannot read a custom property, and it cannot parse oklch, which is
 * what the light palette is written in. So the scene asks the browser: a token
 * is painted into one pixel of a 2D canvas and read back as sRGB. That keeps
 * every colour in a 3D slide a theme token, and a colour mode switch repaints
 * the scene the way it repaints the rest of the slide.
 */
const tokens = {
  amber: "--slide-amber",
  background: "--background",
  card: "--card",
  foreground: "--foreground",
  muted: "--muted-foreground",
  primary: "--primary",
  signal: "--slide-signal",
} as const

export type ThemeColors = Record<keyof typeof tokens, Color>

function read(element: Element): ThemeColors {
  const style = getComputedStyle(element)
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  const out = {} as ThemeColors

  for (const [key, name] of Object.entries(tokens)) {
    const value = style.getPropertyValue(name).trim() || "black"
    const color = new Color()
    if (context) {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      color.setRGB(r / 255, g / 255, b / 255, "srgb")
    }
    out[key as keyof ThemeColors] = color
  }

  return out
}

export function useThemeColors(
  ref: RefObject<Element | null>
): ThemeColors | null {
  const [colors, setColors] = useState<ThemeColors | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    setColors(read(element))

    // The mode lives on <html> as a class and on the canvas as an attribute,
    // so either one changing is a reason to read the tokens again.
    const observer = new MutationObserver(() => setColors(read(element)))
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "data-slide-color-mode"],
      attributes: true,
    })
    const canvas = element.closest("[data-slide-canvas]")
    if (canvas) {
      observer.observe(canvas, {
        attributeFilter: ["data-slide-color-mode"],
        attributes: true,
      })
    }
    return () => observer.disconnect()
  }, [ref])

  return colors
}
