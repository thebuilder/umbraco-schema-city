import { defineDeck } from "@thebuilder/deckard-core"
import { slides } from "@/deck/slides"
import { theme } from "@/deck/theme"

export const deck = defineDeck({
  canvas: {
    fit: "contain",
    height: 1080,
    mode: "fixed",
    width: 1920,
  },
  description: "Schema City at the Umbraco DK meetup, 22 October 2026.",
  footer: {
    mode: "visible",
  },
  header: {
    brand: "schema-city",
    href: "/",
    mode: "auto",
  },
  slides,
  theme,
  title: "Schema City",
})
