import type { SlideTheme } from "@thebuilder/deckard-core"

import "./theme.css"

export const theme = {
  card: {
    colors: {
      dark: {
        accent: "#86fadd",
        background: "#05090a",
        foreground: "#e9f6f1",
        muted: "#87a39d",
      },
      light: {
        accent: "#06702b",
        background: "#f3f8f4",
        foreground: "#092812",
        muted: "#4a644f",
      },
    },
    font: {
      family: "JetBrains Mono",
      uppercase: true,
      weight: 700,
    },
  },
  className: "afterglow-theme",
  colorModes: ["light", "dark"],
  defaultColorMode: "dark",
  id: "afterglow",
} satisfies SlideTheme
