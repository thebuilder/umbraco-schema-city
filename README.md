# Schema City

Schema City helps Umbraco developers inspect a content model before changing it. Follow a
Document Type's relationships, investigate configuration problems, and open the type in the
backoffice editor.

Each building represents a Document Type. Floors represent property groups, and connections show
allowed children, compositions, block targets, and picker references. Schema City reads your model;
it does not change your schema or content.

![The city overview with Pages, Elements, Compositions and Unfiled districts and faint structure connections.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/city.png)

The screenshots use the included demo schema with 78 types and deliberately planted problems.
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

Open [localhost:5173](http://localhost:5173). The fixture selector switches between small, medium,
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

Use Search or `⌘K` / `Ctrl+K` to find a type by name, alias, or property alias. Hover a building to
see its name and direct connections. Click it to keep those connections visible and open the
inspector, which shows properties, composition origins, usage counts, and related types.

Layer switches control the background overview. Hover and selection reveal direct connections
across all layers, including ones you have switched off.

| Layer | Relationship |
| --- | --- |
| Structure | Which Document Types can be created below another type |
| Compositions | Shared compositions and inheritance |
| Blocks | Element Types configured as block content or settings |
| References | Document Types allowed by configured pickers |

Click a connection or use Explain connections in the inspector to see what it represents.
Open in editor takes you to the selected Document Type in Umbraco.

### Focus on a neighbourhood

Double-click a building, press Enter with a type selected, or choose Focus in the inspector.
Focus arranges the selected type and its neighbours together. Expand one step adds the next
connected types while keeping the existing focused positions. Escape leaves focus; press it
again to clear the selection.

![Home in focus mode with its neighbouring types, direct connections and inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

### Review findings

Findings lists unused types, duplicate aliases, missing block targets, empty types, and other
configuration checks. Filter by category, select a result, and inspect the explanation and related
types. Export CSV saves the filtered results with schema and usage timestamps for a ticket or review.

![Findings filtered to dead ends, duplicate aliases, broken blocks, empty types and complexity checks.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

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
The inspector reports them separately. Usage is a snapshot, cached on the server for one minute;
it is not a live dependency check.

### Use the table

List shows the same types in a searchable, sortable table. Click a column heading to sort it or a
type to open the inspector. The table works without the 3D canvas.

![The type list sorted by own property count, largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

## Compare schema snapshots

Open Compare and export the current schema before making a change. Later, import that JSON file
as a baseline, or import a snapshot from another environment. The comparison lists added and
removed types, property and group changes, compositions, and relationship changes.

Matched buildings keep their baseline positions. New types appear on separate added boards.
Comparison covers schema configuration only. It does not compare content usage or dependencies
in custom code. Snapshot import is for review and does not apply changes to Umbraco.

Outside comparison mode, layouts are deterministic for the same schema. Adding or removing types
can rearrange the city; manual pinning is not available.

## Navigate the city

Iso and Top down use the same world coordinates. Pan and zoom in either view; keyboard movement
continues while the camera changes angle. The brief opening animation respects reduced-motion
preferences.

![The same schema in Top down view with structure connections.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/top-down.png)

| Action | Control |
| --- | --- |
| Pan | Drag, WASD, or arrow keys |
| Pan faster | Hold Shift with a movement key |
| Zoom | Mouse wheel |
| Switch camera | E or the Iso / Top down buttons |
| Focus selected type | Enter |
| Leave focus, then clear selection | Escape |
| Reframe the city or leave focus | Home |
| Toggle connection layers | 1, 2, 3, 4 |
| Switch list view | L |
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
