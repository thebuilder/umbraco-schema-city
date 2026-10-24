# Schema City

See your Umbraco content model as a map in the backoffice, or as a city in 3D. Each Document
Type is a card, grouped into districts by where editors can create it. Lines between cards show
allowed children, compositions, block targets and picker references. Use it to understand a
schema before you change it.

**[Try the demo](https://schema-city-demo.thebuilder.dk)** in your browser. It needs no Umbraco
install.

![The demo schema on the map with structure lines on: the Site district with Compositions, Microsite, Unreachable and Settings around it, and the Overview in the corner.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/map.png)

Schema City never changes your Document Types, Data Types or content. The only thing it writes is
the decisions you record on findings.

## Install

```bash
dotnet add package TheBuilder.SchemaCity
```

Restart the site and open **Settings > Advanced > Schema City**. Every Document Type editor also
gets a **Relationships** tab that opens the map focused on that type.
Set `"SchemaCity": { "RelationshipsTab": false }` in `appsettings.json` to leave that tab out.

It comes in two looks over the same panels. The **map** is the default: a flat, zoomable diagram
in the backoffice's own colours and type, which follows the user's light or dark theme. The
**3D city** draws the same schema as buildings on circuit boards, in a green terminal look. To use
the city instead, set `"SchemaCity": { "Variant": "City" }`, which applies to every user and to
the Relationships tab. Earlier versions had only the city, so after an upgrade users open on the
map unless the site sets that. [Try the City demo](https://schema-city-demo.thebuilder.dk/city/).

| Requirement | Version |
| --- | --- |
| Umbraco | 17 or 18, tested on 17.6.2 and 18.1.1 |
| .NET | 10 |
| Backoffice user | Access to the Settings section |

## What you can do with it

### Find your way around a schema

Search by name, alias or property alias with `⌘K` / `Ctrl+K`. Hover a card to see what it
connects to. Click it to open the inspector with its properties, compositions, parents, children
and block targets. Double-click to focus on a type and its neighbours.

![Home in focus mode with its neighbouring types and their lines, and the inspector docked beside the map.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

### Catch problems before they ship

Findings checks the schema for blocks that point at deleted Element Types, duplicate aliases,
unused types and Data Types, types no editor can reach, culture mismatches and overloaded tabs.
Each row names the evidence and opens the type it is about. Mark a deliberate one as intentional
with a reason, and it reopens by itself if the type changes later. Export the list as CSV for
your issue tracker.

![Findings grouped by kind, broken blocks and duplicate aliases first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

### See what content uses

Colour the cards by content count, published share, cultures, incoming references or unused types.
Each Data Type has a page that shows which types use it and, for block editors, how many blocks of
each Element Type content stores.

![The content count lens, with Article selected and its usage in the inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

### Know what a change will touch

Impact lists every type a change reaches through compositions, blocks, allowed children and
pickers, with the path to each one and its content count. Check a new property alias against every
type it would land on to catch collisions early. Copy the result as Markdown for a ticket.

![Seo Composition's impact reaches 37 types and 188 content items, with an alias collision on one type.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/impact.png)

### Compare environments

Export a snapshot of the schema, then compare against it later, or against a snapshot from
another environment. Changes are grouped by cause, so adding one type reads as one change with
the types it affected under it. Tick off what you planned and see what nobody asked for.

![A comparison with four causes, three marked planned, and one opened on its side effects.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/compare.png)

### Read the schema without the map

List, Tree, Matrix and Editor show the schema without the map and work from the keyboard:

- **List** is every type in a sortable table.
- **Tree** shows what editors can create under each root, and which types they cannot reach.
- **Matrix** crosses types with compositions or with Data Types.
- **Editor** lays a type out in tabs and groups, the way editors see it.

![The creation tree from the three root types, with the unreachable types below.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/tree.png)

### Show it to a room

Press **P** for presentation mode. The schema fills the screen with larger names, and a caption
card replaces the inspector.

## Good to know

- Treat a finding as a reason to look before you delete anything. Custom code, templates,
  migrations and external systems can depend on a type that no content uses.
- Usage counts are a snapshot, cached for one minute. Block counting stops after 50,000 values or
  five seconds, and the app says when it did.
- Decisions on findings are stored in Umbraco's `umbracoKeyValue` table, so the package needs no
  migration. Every user with Settings access sees the same decisions.
- The screenshots come from the demo, which has 86 types with problems planted on purpose. They
  show the app without the backoffice around it.

## Keyboard

| Action | Key |
| --- | --- |
| Search | `⌘K` / `Ctrl+K` |
| Focus the selected type | Enter |
| Leave focus, then clear the selection | Escape |
| Reframe the map | Home |
| List, Tree, Matrix | L, T, M |
| Editor or Impact for the selected type | E, I |
| Presentation mode | P |
| All controls | ? |

## More

- The [docs](https://schema-city.thebuilder.dk) cover every view, check and control in detail.
- The [development guide](https://github.com/thebuilder/umbraco-schema-city/blob/main/docs/development.md)
  covers building, the demo site, tests and packaging.
- Report a problem or suggest an improvement in
  [GitHub issues](https://github.com/thebuilder/umbraco-schema-city/issues).

MIT licence.
