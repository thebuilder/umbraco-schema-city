---
title: Navigate the city plan
description: Move around the city plan, use its toolbar and the Overview, focus a type, and use the keyboard and a screen reader.
seo:
  image: /og/navigation.png
---

The city plan opens framed at a zoom where names read. A schema too big for that opens at its top left, and the **Overview** in the bottom-right corner shows the rest. Press <kbd>?</kbd> at any time for every control.

If you lose your place, press <kbd>Home</kbd> or choose **Reset view** in the toolbar to frame the plan again. When you ask for reduced motion, the plan jumps to each new view rather than gliding there.

The 3D city has its own camera controls. See [The 3D city](/3d-city#move-the-camera).

## Mouse

| Action | Control |
| --- | --- |
| Move the plan | Drag |
| Zoom toward the point under the cursor, or away | Scroll or pinch |
| Light a type's lines | Hover a card while nothing is selected |
| Select a card | Click. Click empty space to clear the selection. Focus stays on. |
| Focus a card | Double-click |
| Move around the whole schema | Drag or scroll the Overview |

## Keys on the plan

| Action | Key |
| --- | --- |
| Move the plan | Arrow keys, unless a list, field or panel has the keyboard |
| Move twice as far | Hold <kbd>Shift</kbd> with an arrow key |
| Zoom in and out | <kbd>+</kbd>, <kbd>-</kbd> |
| Frame the whole plan, or leave focus | <kbd>Home</kbd>, or **Reset view** in the toolbar |

## Keys in every view

| Action | Key |
| --- | --- |
| Focus selected type | <kbd>Enter</kbd> |
| Leave focus, then clear selection | <kbd>Esc</kbd> |
| Toggle connection layers | <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> |
| Switch to List, Tree or Matrix, or back to the plan | <kbd>L</kbd>, <kbd>T</kbd>, <kbd>M</kbd> |
| Open the selected type's Editor or Impact page, or go back | <kbd>E</kbd>, <kbd>I</kbd> |
| Search | <kbd>⌘</kbd> <kbd>K</kbd> or <kbd>Ctrl</kbd> <kbd>K</kbd> |
| Present full screen, or leave | <kbd>P</kbd>, or <kbd>Esc</kbd> to leave |
| Show controls | <kbd>?</kbd> |

## Use the toolbar

The toolbar floats over the top-left corner of the plan. It holds **Layers**, **Group** and **Lens**, then the lens's colour key while a lens is on, then **Legend** and **Reset view**. Where the plan is narrower than about 760 px, they fold into one **Plan tools** button. The toolbar hides while you present.

- **Layers** chooses which connections the plan draws. See [Switch connection layers](/investigate-a-type#switch-connection-layers).
- **Group** chooses how the plan is cut into districts. See [Lay out the city plan](/layout).
- **Lens** colours the cards by content usage. See [Check content usage](/content-usage).
- **Legend** opens a window that explains the cards and lines. It stays open while you work on the plan.

The footer says how many types the schema has, and, on hover, when the schema and the usage were read. It also holds **Present**.

## Select and focus

Click a card to select it. The inspector docks beside the plan, and the plan narrows to make room, so nothing moves under the pointer. A card the inspector would cut off slides into view. Where the workspace is too narrow for both, the inspector covers the plan instead.

Double-click a card, or press <kbd>Enter</kbd> with a type selected, to focus it. Focus shows the type and its neighbours on their own, and **Expand one step** in the inspector adds the next ring. See [Focus on a neighbourhood](/investigate-a-type#focus-on-a-neighbourhood).

## Zoom out

Names stay readable as you zoom out, and each card shows less:

- Close up, a card shows its icon, its name, its property count and its size bar.
- Further out, it shows its name alone, on up to two lines.
- Further out again, the name takes one line, cut short where it must be.
- Furthest out, a card is a tile of its colour with only its size bar. The tooltip and the inspector still have the name.

District names keep their size on screen as you zoom out, so the districts still read when every card is a tile.

The **Overview** in the bottom-right corner is a small copy of the whole plan, with the part in view marked. Drag or scroll it to move around. It hides where the plan is narrower than about 900 px.

## Use the keyboard and a screen reader

The header, the footer, the panels and the views work from the keyboard. Use Search or the List view to pick a type without the mouse.

- The plan puts one card in the tab order: the selected card, or the first card when nothing is selected. <kbd>Enter</kbd> selects it, and <kbd>Enter</kbd> again focuses it. The arrow keys move the plan, not between cards, so use Search to reach another type.
- Arrow keys move between the view switcher's views and between tabs.
- Every scrolling area takes focus so it can scroll.
- Opening a type from a panel or Search puts focus on its name in the inspector. A type picked on the plan keeps focus on the plan, so its keys keep working. Closing the inspector returns focus to what opened it.
- A screen reader hears selection, view, layer and focus changes and filter counts as they happen.
- The List view is the schema as a table.
- The dialogs and the drawers respect your reduced-motion setting.
