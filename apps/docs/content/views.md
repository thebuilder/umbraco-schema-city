---
title: Move between views
description: Switch between the City, List, Tree, Matrix and Editor views, most of which work without the 3D canvas.
seo:
  image: /og/views.png
---

The header holds what works on the whole schema:

- the view switcher, with City, List, Tree, Matrix and Data Types
- Search, Findings, Compare and the control reference

The chosen view is kept in the URL. Every view except City works without the 3D canvas.

Editor and Impact are the two pages about one type. Open them from the selected type's inspector with Editor view and Impact, or press E and I. A line over the page names the type and leads back to the view you came from, with the selection kept. With nothing selected, E and I open nothing and say "Pick a type first" instead. A link with `view=editor` or `view=impact` and a type still opens that page. Without a type it opens the city.

The footer says how many types the city has and when the schema and the usage were read. It gives the time if that was today and the date otherwise, in your own time zone. It says "usage loading" while that request is still out.

In the City the footer also holds the City's own tools, Layers, Group, Lens, Legend and Reset view. Present is there in every view. Where the workspace is narrower than about 960 px, the City's tools fold into one City tools menu.

## Use the List view

List shows the same types in a searchable, sortable table, and works without the 3D canvas. Click a column heading to sort by it, or click a type to open the inspector.

Each type's role is shown in the city's colours, and a pink dot marks a type with a problem finding. Content counts are blank for Element Types and for compositions nothing creates, as on the inspector's chips, since neither holds content of its own.

![The type list sorted by own property count, largest first.](../../../docs/screenshots/list.png)

## Follow the creation tree

Tree shows what an editor can create under each root. It starts at each type allowed at root and follows the allowed-child rules.

- A type allowed under two parents appears under both.
- A type that already appears higher in the same branch is marked and not expanded again.
- Once usage has loaded, each type shows its content count across the whole site, on its first row only. A repeat of the type further down says same type.
- Types without content are drawn quieter, so the branches where content lives stand out.
- A pink dot marks a type with a problem finding, and its tooltip names the checks.

Below the tree, a list shows the Document Types that no root can reach, with the types they are allowed under. This shows a chain that only hangs off another unreachable type. Element Types and compositions that nothing can create are left out of that list.

![The creation tree from the three root types, with Home selected under Site and the unreachable types below.](../../../docs/screenshots/tree.png)

## Compare types in a matrix

Matrix has two grids.

**Compositions** shows which types use which compositions, and marks a composition that arrives through another one. Umbraco records a parent type as a composition of the types that inherit from it, so a parent appears as a column too, marked parent.

**Data Types** shows how many of each type's own properties use each Data Type. Each column is headed by the Data Type name, with the property editor alias and the start of the Data Type key below it, so two Data Types with similar names can be told apart. Rows are sorted by name, and columns sort by usage or by name.

![The compositions matrix, with Seo Composition used by most page types.](../../../docs/screenshots/matrix.png)

## Read a type as an editor sees it

Editor draws the selected type as tabs and groups, the way editors see it. Choose Editor view in the inspector, or press E, to open the selected type here.

- Tabs and groups come in the order the schema lists them.
- Each property shows its name, alias, Data Type, mandatory marker and culture variance. The property editor alias shows on hover, and a screen reader reads it after the Data Type.
- A group from a composition names the composition once on its header and starts folded, so the properties the type adds itself stand out. The view opens on the first tab that has any of them. Expand composed groups opens the folded groups.
- The type's checks sit above the tabs, and a tab with more than 20 properties is marked.
- Rows the checks are about say so in pink. These are both properties of a duplicate alias, with the editor each one uses, a block property that lists a deleted Element Type, and the properties of a culture mismatch. A folded group with such a row carries a dot.

![Home on the Editor page, opened on the Content tab where its own properties are, with its checks above the tabs.](../../../docs/screenshots/editor.png)
