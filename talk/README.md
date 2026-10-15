# Schema City talk

The deck for the Schema City talk at the Umbraco DK meetup on 22 October 2026.
It is a [Deckard](https://deckard.thebuilder.dk) app with an ejected theme
retuned to the Afterglow palette.

```bash
npm install
npm run dev
```

Present from Chrome, since the effects use WebGPU. `P` opens the presenter
window with the speaker notes.

- `deck/slides.tsx` holds the order, the timings and the speaker notes.
- `deck/parts/` holds one file per slide visual, so each can be built on its
  own. A slide that is not built yet renders a `Placeholder` describing what
  goes there.
- `deck/theme/` is the theme. Read its `THEME.md` before changing a token.

Before handing a change back, run `npx deckard validate`,
`npx deckard check-overflow` and `npx deckard contact-sheet`.

## Importing Schema City's own code

Slides import the client's scene, layout and model modules directly, as
`@schema-city/app/scene/...`, so the city on a slide is the city in the
package. `next.config.ts` widens Turbopack's root to the repository and pins
React, three and the other shared packages to this app's `node_modules`, so a
module from `src/SchemaCity/Client` never pulls a second copy. Keep the
versions here equal to the client's `package.json`.
