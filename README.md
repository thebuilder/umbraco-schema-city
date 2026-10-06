# Schema City

Schema City helps Umbraco developers inspect a content model before changing it. Follow a
Document Type's relationships, investigate configuration problems, and open the type in the
backoffice editor.

Each building represents a Document Type. Floors represent property groups, and connections show
allowed children, compositions, block targets, and picker references. Schema City reads your model;
it does not change your schema or content.

![The city overview with Pages, Elements, Compositions and Unfiled districts and faint structure connections.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/city.png)

The screenshots use the included demo schema with 86 types and deliberately planted problems.
They show the standalone client, without the surrounding Umbraco backoffice.

## Try it locally

For a quick look, run the client against the included JSON fixtures. No Umbraco installation or
login is needed. Use Node.js 24 and npm.

```bash
git clone https://github.com/thebuilder/umbraco-schema-city.git
cd umbraco-schema-city/src/SchemaCity/Client
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173). The sample selector in the footer switches between small, medium,
and pathological schemas. Editor links in this demo log the selected type to the browser console.
They open real editors when the extension runs inside Umbraco.

## Use it in Umbraco

The project targets .NET 10 and supports Umbraco 17 and 18. CI checks 17.6.2 and 18.1.1.
The `SchemaCity` package is not yet published on NuGet, so use a project reference for now.
From this repository's root, replace the site path with your Umbraco project:

```bash
dotnet add /path/to/YourSite.csproj reference src/SchemaCity/SchemaCity.csproj
```

Build and restart your site. Node.js and npm are needed for the first build, which produces the
client assets. Open Settings > Advanced > Schema City. A Document Type editor also gets a
Relationships tab focused on that type.

Your backoffice user needs access to Settings. Both API endpoints enforce that permission.
The included [demo Umbraco site](src/SchemaCity.Site/README.md) provides a seeded installation
for testing the integration.

## Investigate a type

Use Search or `⌘K` / `Ctrl+K` to find a type by name, alias, or property alias. Every type's name
is printed on the board in front of its building, cut short with an ellipsis when the building has
no room for all of it. The print appears as you zoom in and turns to stay readable when you orbit
to the far side. Hover a building to see its direct connections and the names of connected types;
the names of unrelated types dim. Floating labels that would overlap stay hidden until there is
room for them, and a related type whose whole name is already legible on the board gets no
floating label. Click a building to keep its connections visible and open the
inspector. Its header names the type, its role (page, composition or Element Type) and how much
content uses it. Overview lists the schema checks for the type, its usage, and its related types,
with content counts once usage has loaded. Properties shows each group with the composition it
comes from and each property's Data Type. Connections lists every configured connection by kind,
block and picker targets by property, and the references counted in content separately. Click a
related type to select it.

Each building is built like a chip on a circuit board. Every slab is one property group, with a
gap between groups and a thin board where a new tab starts; the lit windows are its properties.
Composed groups are translucent azure, and a composition that no content can be created from is
made of those shells alone. Element Types are low amber blocks. Pins along the base count direct
connections: allowed parents on the north edge, allowed children on the south, other links out on
the east and in on the west. A lit lid means the type has a template, and a dot on the roof means
it varies by culture (a second dot: by segment). The Legend button lists these.

Layer switches control the background overview. Hover and selection reveal direct connections
across all layers, including ones you have switched off.

| Layer | Relationship |
| --- | --- |
| Structure | Which Document Types can be created below another type |
| Compositions | Shared compositions and inheritance |
| Blocks | Element Types configured as block content or settings |
| References | Document Types allowed by configured pickers |

Click a connection, or use Explain connections at the end of the inspector's Connections tab, to
see what it represents.
Open in editor takes you to the selected Document Type in Umbraco.

### Focus on a neighbourhood

Double-click a building, press Enter with a type selected, or choose Focus in the inspector.
Focus arranges the selected type and its neighbours together. Expand one step adds the next
connected types while keeping the existing focused positions. Escape leaves focus; press it
again to clear the selection.

![Home in focus mode with its neighbouring types, direct connections and inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

### Review findings

Findings lists unused types, duplicate aliases, missing block targets, empty types, and other
configuration checks. Results are grouped by kind in a fixed order, definite breakages such as
broken blocks and duplicate aliases first: each group explains the kind once, and each row shows the
type and what is particular to it, such as where an unused type is allowed. Problems are open and
notes collapsed. Within a group, the strongest cases come first, for example an unused
type whose allowed parents have no content either. Filter by category, select a result, and inspect
it with its related types. Export CSV saves the filtered results with schema and usage timestamps
and the kind's explanation for a ticket or review.

Only a type an editor can create, at root or under another type, is reported as unused. A type
nothing can create is a dead end, or a pure mixin when something composes it. The no template note
is left out when more than half of the creatable types have no template, since that schema is
headless by design, and on a type already reported as unused.

- Unreachable chain: a type with allowed parents, none of which a root can reach.
- Culture mismatch: an invariant type with a property that varies by culture, or with a block
  editor that lists an Element Type that varies by culture.
- Near-duplicate Data Type: Data Types whose names match once case, spaces, hyphens and
  underscores are ignored. Each set is one note, on a type that uses the least-used of them, and
  lists every other type that uses any of them.
- Overloaded tab: a tab, or a group on a type without tabs, with more than 20 properties, composed
  ones included.
- Empty block: an Element Type offered as a content block that has no properties. It is a note,
  because a divider or spacer block is often empty on purpose.

![Findings grouped by kind with broken blocks and duplicate aliases first, each row naming its own evidence.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

A finding is a reason to investigate, not an instruction to delete. An unused Document Type has
no counted content in the usage snapshot. An unused Element Type has no configured block-editor
use in the schema snapshot. Custom code, migrations, external consumers, and stored block values
can still depend on either.

### Check content usage

The Lens menu colours buildings by content count, published share, cultures, incoming references,
or unused status. Select a type to read the counts in the inspector. Usage loads separately from
the schema, so you can explore the model while that request is pending.

![The Content count lens with Article selected and its usage totals shown in the inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

Configured picker connections and observed references between content items are different data.
The inspector's Connections tab reports them separately, under Picker references and Observed in
content. Usage is a snapshot, cached on the server for one minute;
it is not a live dependency check.

### Use the table

List shows the same types in a searchable, sortable table, with each type's role in the city's
colours and a pink dot beside a type that has a problem finding. Click a column heading to sort it
or a type to open the inspector. The table works without the 3D canvas.

![The type list sorted by own property count, largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

The view switcher in the toolbar chooses between City, List, Tree, Matrix and Editor. The choice is
kept in the URL, and every view except City works without the 3D canvas.

### Follow the creation tree

Tree starts at each type allowed at root and lists what an editor can create under it, following
the allowed-child rules. A type allowed under two parents appears under both. A type that already
appears higher in the same branch is marked and not expanded again. Below the tree, a list shows
Document Types that no root can reach, with the types they are allowed under, so a chain that
only hangs off another unreachable type is visible. Element Types and compositions that nothing
can create are left out of that list. Once usage has loaded, each row shows its content count and
types without content are drawn quieter, so the branches where content lives stand out. A pink dot
marks a type with a problem finding, and its tooltip names the checks.

![The creation tree from the three root types, with Home selected under Site and the unreachable types below.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/tree.png)

### Compare types in a matrix

Matrix has two grids. Compositions shows which types use which compositions, and marks a
composition that arrives through another one. Data Types shows how many of each type's own
properties use each Data Type. Each column is headed by the Data Type name, with the property
editor alias and the start of the Data Type key below it, so two Data Types with similar names
stay distinguishable. Rows are sorted by name; columns sort by usage or by name.

![The compositions matrix, with Seo Composition used by most page types.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/matrix.png)

### Read a type as an editor sees it

Editor draws the selected type as tabs and groups, in the order the schema lists them, with each
property's name, alias, Data Type, mandatory marker and culture variance; the property editor alias
is on hover. A group from a composition names it once on its header and starts folded, so the
properties the type adds itself stand out, and the view opens on the first tab that has any of
them. Expand composed groups opens the folded groups. The type's checks sit above the tabs, and a
tab over 20 properties is marked. Choose Editor layout in the inspector to open a type here.

![Home in the editor view, opened on the Content tab where its own properties are, with its checks above the tabs.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/editor.png)

## Compare schema snapshots

Open Compare and export the current schema before making a change. Later, import that JSON file
as a baseline, or import a snapshot from another environment. The comparison lists added and
removed types, property and group changes, compositions, and relationship changes.

Matched buildings keep their baseline positions. New types appear on separate added boards.
Comparison covers schema configuration only. It does not compare content usage or dependencies
in custom code. Snapshot import is for review and does not apply changes to Umbraco.

Outside comparison mode, layouts are deterministic for the same schema. Each top-level folder is a
district, and a district's place and the order of its loose types follow their connections: an
Element Type sits under the pages that use it, a composition over the pages that compose it. So
adding or removing types, or connections between them, can rearrange the city; manual pinning is
not available.

## Navigate the city

The city stands in a 3D world with a sky, a horizon and a ground that runs out to it. It opens on a
raised three-quarter view of the whole city, and from there you can orbit, pan, dolly toward any
point and come down to street level. Focusing a type, leaving focus and Home fly the camera to the
new framing. The establishing flight plays on the first visit in a browser only. The brief
opening animation and that flight respect reduced-motion preferences.

| Action | Control |
| --- | --- |
| Orbit | Drag |
| Move toward the cursor, or away | Mouse wheel |
| Pan along the ground | Right-drag, W, A, S, D or arrow keys |
| Rise and descend | R, F |
| Move faster | Hold Shift with a movement key |
| Focus selected type | Enter |
| Leave focus, then clear selection | Escape |
| Reframe the city or leave focus | Home |
| Toggle connection layers | 1, 2, 3, 4 |
| Switch to List, Tree, Matrix or Editor, or back to the city | L, T, M, E |
| Search | ⌘K / Ctrl+K |
| Show controls | ? |

## Development

See the [development guide](docs/development.md) for build commands, the backoffice watch loop,
API routes, checks, and packaging. The [demo site guide](src/SchemaCity.Site/README.md) covers login
and seeded data. [Product direction](docs/product-direction.md) separates current workflows from
planned features. [PLAN.md](PLAN.md) retains the original implementation notes.

Report problems or suggest improvements in [GitHub issues](https://github.com/thebuilder/umbraco-schema-city/issues).

## Licence

MIT.
