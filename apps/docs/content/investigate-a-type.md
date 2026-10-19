---
title: Investigate a type
description: Search, hover, select and focus on a Document Type, and read the boards, buildings and names in the city.
seo:
  image: /og/investigate-a-type.png
---

Use Search or `⌘K` / `Ctrl+K` to find a type by name, alias or property alias.

Hover a building to see its direct connections and the names of connected types. The names of unrelated types dim. Floating labels that would overlap stay hidden until there is room for them.

Click a building to keep its connections visible and open the inspector. Click a related type in the inspector to select it. Open in editor takes you to the selected Document Type in Umbraco.

The inspector's header names the type, its role (page, composition or Element Type) and how much content uses it. Its Editor view and Impact buttons open the pages about the type. The inspector has four tabs:

- **Overview** lists the schema checks for the type, its usage and its related types, with content counts once usage has loaded.
- **Properties** shows each group with the composition it comes from, and each property's Data Type.
- **Connections** lists every configured connection by kind, and block and picker targets by property. References counted in content are listed separately.
- **Impact** lists what a change to the type reaches. See [Trace the impact of a change](/impact).

Every type opens on Overview, including one you looked at before. The number on a type chip is the number of content items of that type across the site. Under Observed in content it is the number of references instead.

Click a connection, or use Explain connections at the end of the Connections tab, to see what it represents.

## Read the boards and buildings

Each district is a circuit board. It has a core with copper and solder mask over it, rounded corners with plated mounting holes, and a faint copper pour. A gold finger on a board's edge marks each lane of connections that leaves it for another board. A via marks each point where a trace turns.

Each building is built like a chip on that board:

- Its side grows with the square root of its own property count. Size still tracks property count, but a few large types do not push the city apart.
- Each slab is one property group, with a gap between groups. A thin board marks where a new tab starts. The lit windows are its properties.
- Composed groups are translucent azure. A composition that no content can be created from is made of those shells alone.
- Element Types are low amber blocks.
- Pins along the base count direct connections. Allowed parents are on the north edge, allowed children on the south, other links out on the east and links in on the west.
- A lit lid means the type has a template. A dot on the roof means it varies by culture, and a second dot means it varies by segment.

The Legend button lists these.

## Read the names on the boards

Every type's name is printed on the board beside its building, inside the silkscreen outline round the part. From the overview most names are already readable. The full name is always in the floating label and the inspector.

- As many names print as fit without touching, larger types first, then types with more content. Their places are worked out once for the layout, so panning, orbiting and hovering never move a name.
- Each board prints at one of three sizes, picked by how far away it is. Closer in, the print gets smaller and more of each name fits. A little slack stops it switching back and forth, and the old and new print cross-fade.
- A name too small to read fades out, and back in once it reads again.
- A name with no room on one line wraps onto two at a word. If it is still too wide, it drops the words its board already says, such as Element on the Elements board or Page among pages, then whole trailing words behind an ellipsis. It never shortens so far that it could be another name on the same board, and nothing is cut inside a word. A name that still does not fit waits until you come closer.
- Names keep off the traces where they can. A name that has to lie over a trace gets a patch of bare board under it, so the trace reads as passing beneath.
- Names and district names turn to stay readable when you orbit to the far side.
- A related type whose board prints its whole name legibly gets no floating label. The hovered or selected type's printed name gives way to its floating label.

![Closer in on the Site board, with whole printed names, vias where traces turn and a gold finger where traces leave for the Microsite board.](../../../docs/screenshots/names.png)

## Switch connection layers

Layer switches control the background overview. Hover and selection show direct connections across all layers, including ones you have switched off.

| Layer | Relationship |
| --- | --- |
| Structure | Which Document Types can be created below another type |
| Compositions | Shared compositions and inheritance |
| Blocks | Element Types configured as block content or settings |
| References | Document Types allowed by configured pickers |

## Focus on a neighbourhood

Focus arranges the selected type and its neighbours together. To focus, double-click a building, press Enter with a type selected, or choose Focus in the inspector.

- Expand one step adds the next connected types and keeps the existing focused positions.
- Closing the inspector or clicking bare ground clears the selection and stays in focus, so the neighbourhood stays on screen.
- Leave focus in the inspector, Escape, Home and Show all leave focus. With a type selected, Escape leaves focus first and clears the selection on a second press.
- While focus is on, List, Tree and Matrix show only the focused types. A line above them says how many and offers Show all.

![Home in focus mode with its neighbouring types, direct connections and the inspector.](../../../docs/screenshots/focus.png)
