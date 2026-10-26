---
title: Lay out the city plan
description: Choose how the city plan is cut into districts, and how types are placed in each one.
seo:
  image: /og/layout.png
---

**Group** in the toolbar over the city plan chooses how the schema is cut into districts. The choice is kept in the URL.

- **Structure** is the default. It gives each type allowed at root its own district with everything it can create.
  - A type that several roots or parents allow sits with the one that a breadth-first walk from the roots reaches it from first. The lines show the rest.
  - Element Types share one district, Elements.
  - Compositions have their own district, and the types no root can reach go in Unreachable.
- **Folders** gives each top-level Document Type folder a district.

Grouped by structure, a district reads from the top down, as editors create content:

- **Level 1** holds the type allowed at root, **Level 2** what it allows, and so on, one allowed-child step per level. A label and a line mark where each level starts.
- A level with more than six cards wraps onto more lines, set closer together than the levels.
- A type that no root in the district leads to stands on a last level, **Not below a root here**.
- Compositions, Elements and Unreachable have no root, so their cards stand in plain rows, and so do the districts when you group by folder.

Within each level the cards are ordered so that as few lines cross as possible, which puts children under their parents. The districts are packed into rows of their own, left to right and top to bottom, so the whole plan fits a screen.

Outside comparison mode, the same schema always gives the same layout. Adding or removing types, or connections between them, can rearrange the plan. You cannot move cards by hand.

In the 3D city, each parent forms a neighbourhood with its allowed children beside it, Element Types stand in one group per block editor, and a board's place follows its connections, so an Element Type sits under the pages that use it and a composition over the pages that compose it. See [The 3D city](/3d-city#where-its-tools-are).
