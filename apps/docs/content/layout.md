---
title: Lay out the city
description: Choose how the city is cut into districts, and how types are placed on each board.
seo:
  image: /og/layout.png
---

The Group control in the footer chooses how the city is cut into districts. The choice is kept in the URL.

- **Structure** is the default. It gives each type allowed at root its own board with everything it can create.
  - Inside a board each parent forms a neighbourhood with its allowed children beside it, so structure traces stay short.
  - A type that several roots or parents allow sits with the one that a breadth-first walk from the roots reaches it from first. The traces show the rest.
  - Element Types share one board, in one group per block editor that offers them. A type offered by several editors goes with the one that offers it as content most often. Each group stands on a lighter patch with the block editor's Data Type name printed along its south edge, even when the editor offers only one type. A type no block editor offers stands on bare board.
  - Compositions have their own board, and the types no root can reach go on Unreachable.
- **Folders** gives each top-level folder a district, as earlier versions did.

In both, a district's place and the order of its loose types follow their connections. An Element Type sits under the pages that use it, and a composition over the pages that compose it.

Outside comparison mode, the same schema always gives the same layout. Adding or removing types, or connections between them, can rearrange the city. You cannot pin buildings by hand.
