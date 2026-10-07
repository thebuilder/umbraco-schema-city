# Schema City

Schema City helps Umbraco developers inspect a content model before changing it. Follow a
Document Type's relationships, investigate configuration problems, and open the type in the
backoffice editor.

Each building represents a Document Type. Floors represent property groups, and connections show
allowed children, compositions, block targets, and picker references. Schema City reads your model;
it does not change your schema or content.

![The city overview: a circuit board for each root, Site, Microsite and Settings, beside boards for Compositions, Elements and Unreachable, with type names printed beside their buildings and faint structure traces.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/city.png)

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
is printed on the board beside its building, inside the silkscreen outline round the part. As many
names print as fit without touching, larger types first, then types with more content, and where
they lie is worked out once for the layout, so panning, orbiting and hovering never move a name.
From the overview most names are already readable. Each board prints at one of three sizes, picked
from how far away it is: as you come closer a board switches to smaller print, a little past the
switch point so it does not switch back and forth, and more of each name fits; the old and new
print cross-fade. A name too small to read fades out, and back in once it reads again. A
name with no room on one line wraps onto two at a word. If it is still too wide it drops the words
its board already says, such as Element on the Elements board or Page among pages, then whole
trailing words behind an ellipsis, never so far that it could be another name on the same board. A
name that still does not fit waits until you come closer; nothing is cut inside a word. Names keep
off the traces where they can, and one that has to lie over a trace gets a patch of bare board under
it, so the trace reads as passing beneath. The full name is always in the floating label and the
inspector. Names and district names turn to stay
readable when you orbit to the far side. Hover a building to see its direct connections and the
names of connected types; the names of unrelated types dim. Floating labels that would overlap stay
hidden until there is room for them. A related type whose whole name its board prints legibly gets
no floating label, and the hovered or selected type's own print gives way to its floating label.
Click a building to keep its connections visible and open the inspector. Its header names the
type, its role (page, composition or Element Type) and how much content uses it. Overview lists the schema checks for the type, its usage, and its related types,
with content counts once usage has loaded. Properties shows each group with the composition it
comes from and each property's Data Type. Connections lists every configured connection by kind,
block and picker targets by property, and the references counted in content separately. The
number on a type chip is the content items of that type across the site, or references under
Observed in content. Click a related type to select it. Every type opens on Overview, also one
you looked at before.

![Closer in on the Site board, where the printed names come out whole inside their courtyards, with vias where traces turn and a gold finger where traces leave for the Microsite board.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/names.png)

Each district is a circuit board: a core with copper and solder mask over it, rounded corners with
plated mounting holes, and a faint copper pour. A gold finger on a board's edge marks each lane of
connections that leaves it for another board, and a via marks each point where a trace turns.

Each building is built like a chip on that board. Its side grows with the square root of its own
properties, so size still tracks property count without a few large types pushing the city
apart. Every slab is one property group, with a
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
connected types while keeping the existing focused positions. Closing the inspector or clicking
bare ground clears the selection and stays in focus, so the neighbourhood stays on screen. Leave
focus in the inspector, Escape, Home and Show all leave it; Escape with a type selected leaves
focus first and clears the selection on a second press. While focus is on, List, Tree and Matrix
show only the focused types, under a line that says how many and offers Show all.

![Home in focus mode with its neighbouring types, direct connections and inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

### Review findings

Findings lists unused types, duplicate aliases, missing block targets, empty types, and other
configuration checks. Results are grouped by kind in a fixed order, definite breakages such as
broken blocks and duplicate aliases first: each group explains the kind once and says what to do next, and each row shows the
type and what is particular to it, such as where an unused type is allowed. Problems are open and
notes collapsed. Within a group, the strongest cases come first, for example an unused
type whose allowed parents have no content either. Filter by category, select a result, and inspect
it with its related types. The drawer's header says when the schema was read and the usage
counted. Export CSV saves the filtered results as one header row and one row per finding, ready for
an Excel or Jira import: the kind, the type with its key, folder, content counts and backoffice
path, the detail, explanation and next step, related types by name, the filter used, and the schema
and usage snapshot dates, then the Data Types the finding names, then its review status, reason,
who decided, when, and whether it reopened. For an unused type, the Unused
branch root column names its topmost unused ancestor, so a branch of unused types can go in one
ticket. A finding about a Data Type alone leaves the type columns blank and gives the Data Type's
backoffice path.

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
- Orphaned blocks: content stores blocks of an Element Type that no block editor lists any more.
  It takes the place of the unused Element Type row once usage has loaded, names the Data Types
  the blocks are stored in, and is a problem.
- Unused Data Type: a Data Type no property on a Document, Media or Member Type uses, and no
  collection view either. The Data Types Umbraco installs itself are left out, since every site has
  a dozen it never uses. It is a note about the Data Type itself and opens its page.

Once usage has loaded, an unused Element Type row says how many blocks of it content stores, and a
broken block row says how many blocks of the missing Element Type content still holds. Rows that
name a Data Type link to its page, and the CSV export gives its name and key in two columns at the
end.

![Findings grouped by kind with broken blocks and duplicate aliases first, each row naming its own evidence.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

A finding is a reason to investigate, not an instruction to delete. An unused Document Type has
no counted content in the usage snapshot. An unused Element Type has no configured block-editor
use in the schema snapshot and, once usage has loaded, no stored block counted either; a count that
stopped early says so. Custom code, migrations, external consumers, and media or member values can
still depend on either.

#### Mark a finding as intentional

Some findings are deliberate: a spacer block with no properties, a mixin kept for one type, a
type an import still reads. Mark as intentional on a row, in the inspector's checks or on a Data
Type's page, asks for a reason of up to 500 characters and records it with your name and the
date. The row then reads "Intentional:" with the reason, and Undo removes the decision. Hide
reviewed, on by default, takes decided rows out of the drawer, so the list shrinks to what still
needs attention, and the header counts both, for example "67 findings, 12 reviewed, 55 open". A
row you decide stays in view until the drawer closes.

A reviewed finding goes quiet everywhere else too, not only in the drawer. In the List, the Tree
and the Data Types list its dot becomes a hollow grey ring whose label starts "Reviewed:". The
inspector's Overview tab and a Data Type's Findings heading count open findings only, with the
reviewed ones said apart, for example "1 reviewed", and the "!" marks open problems only. Reviewed
checks stay listed, greyed out, after the open ones, so you can still read the reason or Undo it.
The Unused lens and the Editor layout's flagged property rows weigh open findings only. A reopened
finding counts as open again in all of these.

![A broken block marked as intentional with its reason and Undo, and the reason form open on a duplicate alias.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/review.png)

A decision is tied to the schema as it was when it was made. The graph carries a fingerprint for
every Document Type and Data Type: a hash of its record, its groups and properties, its templates,
and every connection in or out of it, allowed children, compositions and block targets included.
The decision stores the fingerprint of the type or Data Type the finding is about. When that type
changes, its fingerprint changes, and the finding is open again, shown with the old decision and
"Reopened: the type changed since this was decided." Renaming the type or a Data Type it uses
reopens it too; the check errs towards asking again. Saving checks the fingerprint on the server,
so a decision is never recorded against a type that changed after the page loaded.

Decisions are app data, not schema. They are kept in Umbraco's key-value table
(`umbracoKeyValue`), one row per finding under `SchemaCity.Decision.<finding id>`, as JSON, so
the package needs no migration and nothing in the Document Types, Data Types or content changes.
Undo empties the row rather than deleting it, because Umbraco's key-value service has no delete.
They are shared by everyone who opens Schema City on that site and do not travel with a schema
snapshot or uSync. Recording and undoing need the same Settings section access as the rest of the
extension.

### Check content usage

The Lens menu colours buildings by content count, published share, cultures, incoming references,
or unused status. The Unused lens marks the types the unused checks in Findings flag, and marks
a type in use when it has content, a type composes it or a block editor lists it. Select a type to read the counts in the inspector. Usage loads separately from
the schema, so you can explore the model while that request is pending.

![The Content count lens with Article selected and its usage totals shown in the inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

Configured picker connections and observed references between content items are different data.
The inspector's Connections tab reports them separately, under Picker references and Observed in
content. Usage is a snapshot, cached on the server for one minute;
it is not a live dependency check.

### Use the table

List shows the same types in a searchable, sortable table, with each type's role in the city's
colours and a pink dot beside a type that has a problem finding. Click a column heading to sort it
or a type to open the inspector. Content counts are left blank for Element Types and for
compositions nothing creates, as on the inspector's chips, since neither holds content of its own.
The table works without the 3D canvas.

![The type list sorted by own property count, largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

The view switcher in the toolbar chooses between City, List, Tree, Matrix, Editor and Data Types.
The choice is kept in the URL, and every view except City works without the 3D canvas.

### Follow the creation tree

Tree starts at each type allowed at root and lists what an editor can create under it, following
the allowed-child rules. A type allowed under two parents appears under both. A type that already
appears higher in the same branch is marked and not expanded again. Below the tree, a list shows
Document Types that no root can reach, with the types they are allowed under, so a chain that
only hangs off another unreachable type is visible. Element Types and compositions that nothing
can create are left out of that list. Once usage has loaded, each type shows its content count
across the whole site, on its first row only; a repeat of the type further down says same type.
Types without content are drawn quieter, so the branches where content lives stand out. A pink dot
marks a type with a problem finding, and its tooltip names the checks.

![The creation tree from the three root types, with Home selected under Site and the unreachable types below.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/tree.png)

### Compare types in a matrix

Matrix has two grids. Compositions shows which types use which compositions, and marks a
composition that arrives through another one. Umbraco records a parent type as a composition of
the types that inherit from it, so a parent appears as a column too, marked parent. Data Types shows how many of each type's own
properties use each Data Type. Each column is headed by the Data Type name, with the property
editor alias and the start of the Data Type key below it, so two Data Types with similar names
stay distinguishable. Rows are sorted by name; columns sort by usage or by name.

![The compositions matrix, with Seo Composition used by most page types.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/matrix.png)

### Read a type as an editor sees it

Editor draws the selected type as tabs and groups, in the order the schema lists them, with each
property's name, alias, Data Type, mandatory marker and culture variance; the property editor alias
is on hover, and read after the Data Type by a screen reader. A group from a composition names it
once on its header and starts folded, so the properties the type adds itself stand out, and the
view opens on the first tab that has any of them. Expand composed groups opens the folded groups.
The type's checks sit above the tabs, and a tab over 20 properties is marked. Rows the checks are
about say so in pink: both properties of a duplicate alias, with the editor each one uses, a block
property that lists a deleted Element Type, and the properties of a culture mismatch. A folded
group with such a row carries a dot. Choose Editor layout in the inspector to open a type here.

![Home in the editor view, opened on the Content tab where its own properties are, with its checks above the tabs.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/editor.png)

### Investigate a Data Type

Data Types lists every Data Type in the site, the unused ones included, with its editor, how many
properties use it, on how many types, and the blocks content stores in it. A dot marks one a check
flagged. Sort by any column and filter by name, editor or key. The Data Types Umbraco installs
itself are marked built-in and stay out of the list until you tick Show built-in, except one a link
has opened. Choose one to read its page beside the list, or under it when the room is narrow; the
URL keeps it as `dataType=<key>`. Every Data Type name elsewhere in the app opens this page: the
Matrix's Data Types column headings, the Editor view's property rows, the inspector's Properties
tab and block and picker sections, Data Type changes in Compare, and findings that name a Data
Type.

The page shows the editor's UI alias, its editor alias and its key, and Open in editor opens the
Data Type in the backoffice. A block editor lists the Element Types it offers as content and as
settings, each with the blocks of it content stores, so you can see what a move or a removal would
touch before you make it. An offered Element Type nothing stores has a dashed edge and says none
stored, a key that no longer resolves says missing type, and an Element Type content still stores
but the editor no longer offers gets its own row. A picker lists the Document Types it allows.
Used by lists every type with a property on it, with the property aliases, the composition a
composed one comes from and the type's content count; choose a type to open it in the inspector.
The page ends with the stored block totals, a few configuration values such as a block list's
limits, and the findings about the Data Type. Show in city switches to the City and lights the
buildings that use the Data Type; Clear over the canvas, or choosing a lens, ends it.

Stored blocks are counted with the usage snapshot, in the latest version of every document outside
the recycle bin, published or draft, nested blocks included. The count reads the stored JSON
directly and stops after 50,000 values or five seconds; the page then says the numbers are a lower
bound. Media and member values are not counted.

![SC Page Grid's page: its Element Types with what content stores of each, two offered but never stored, and the types that use it.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/datatypes.png)

### Trace the impact of a change

The inspector's Impact tab lists every type a change to the selected type reaches, by group, with
its content count, and Open impact shows the full trace in place of the view; I or the Impact view
opens it on the selection. The trace follows four relationships, each a toggle:

- Compositions and inheritance: every type that gets the type's properties, directly or through a
  type that inherits or composes it. Press Release reaches Seo Composition through Article.
- Blocks: for an Element Type, every type whose properties offer it, with the property and its
  Data Type, then the types that inherit those properties and the blocks that nest it. The header
  says how many blocks of it content stores, per Data Type.
- Allowed children: the types that allow it as a child and lose a creation option, and the
  allowed children only it leads to from a root, which nobody could create if it were removed.
- Pickers: the types whose picker properties allow it, and the types that carry those properties.

Depth stops the trace after one step, two, or none. Direction turns it round to what the type
depends on: its compositions, the blocks it offers, the types allowed under it and the types its
pickers allow. Every row writes its paths out in words, shortest first, up to three, such as
"Press Release inherits Article, which composes Seo Composition", and says whether the type is
reached directly. A path never visits a type twice, so cycles end. The totals at the top count each
type once.

Planned or existing alias checks a property alias. An alias the type has is traced from the type
that declares it, and lists every type it lands on; a new one is checked against every type it
would land on if added here. Either way, a type that already has the alias from another source is
a collision, the trap in adding a property to a composition: Umbraco compares aliases without
case and a type cannot hold one twice. In the Editor view, each property row's Impact opens the
trace with its alias filled in.

Copy as Markdown copies a ticket-ready summary: the start type, the relationships and depth, the
snapshot dates, the totals, a table per group with each path and content count, and the
collisions. Where the clipboard is blocked, the text is shown selected instead. Export CSV writes
one row per type per group and one per collision, with the same escaping and spreadsheet formula
protection as the findings export. Show in city lights the type and everything the trace reaches.

A trace lists configured relationships to review. It does not say a change is harmless or that it
breaks something: code, templates, and stored values outside the schema can depend on a type too.

![Seo Composition's impact: 37 types and 188 content items, the types that get its properties with each path, and a seoTitle collision on Dup Alias Page.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/impact.png)

## Compare schema snapshots

Open Compare and export the current schema before making a change. The file is named after the
site and the day, as `schema-city-snapshot-example-com-2026-10-07.json`, and records the host it
came from. Later, import that file as a baseline, or import a snapshot from another environment.

The comparison is a list of causes. A cause is one type with edits of its own: added or removed,
properties added, removed or changed, a new Data Type on a property, group and tab changes,
compositions, allowed children, and block or picker targets. The types that only changed because
of a cause are its side effects and sit under it:

- every type that composes or inherits a composition whose properties changed,
- every Element Type whose incoming block relationship changed because a host's block list did,
- every type whose incoming picker or allowed-child relationship changed, and every parent that
  gained or lost an allowed child because that child type was added or removed.

A type with an edit of its own and a side effect too stays a cause, and says what else it is a
side effect of. Nothing is dropped: every line of the comparison sits under exactly the causes
that explain it, and a line nothing explains counts as its type's own edit. The summary reads
"4 causes, 48 side effects, 1 unplanned", where the old flat list said "1 added, 51 changed".

Mark each cause you planned with its Planned box, or Mark all as planned, or Paste a plan as a
list of type aliases. Show unplanned only then leaves the changes nobody asked for. The plan lasts
as long as the baseline does. Copy as Markdown gives a ticket-ready list, with both snapshots'
hosts and dates, the totals, each cause ticked when planned, and its side effects nested under it.
Export CSV gives one row per line, with the cause it belongs to, whether it is the cause's own edit
or a side effect, and whether it was planned.

While a baseline is loaded the city shows a change layer: added types azure, types changed by
their own edit amber with a ring, side effects a quieter amber, removed types as outlines where
they stood, and everything else dimmed. Choosing a lens replaces it until the lens is off again,
and Show in city, from the Impact view or a Data Type, replaces it until you clear it. The List view gets a Change column, sortable and filterable, with a row for each removed type.

Matched buildings keep their baseline positions. New types appear on separate added boards.
Comparison covers schema configuration only. It does not compare content usage or dependencies
in custom code. Snapshot import is for review and does not apply changes to Umbraco.

![Compare against a baseline from before four planned edits: four causes with three marked planned, and Press Release open on the Element Types, parents and pickers that changed only because it was added.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/compare.png)

Outside comparison mode, layouts are deterministic for the same schema. The Group control in the
toolbar chooses how the city is cut into districts, and the choice is kept in the URL:

- Structure, the default, gives each type allowed at root its own board with everything it can
  create. Inside a board each parent forms a neighbourhood with its allowed children laid out
  beside it, so structure traces stay short. A type that several roots or parents allow sits with
  the one a breadth-first walk from the roots reaches it from first, and the traces show the
  rest. Element Types share one board, in one group per block editor that offers them; a type
  offered by several editors goes with the one that offers it as content most often. Compositions
  have their own board, and the types no root can reach go on Unreachable.
- Folders gives each top-level folder a district, as earlier versions did.

In both, a district's place and the order of its loose types follow their connections: an Element
Type sits under the pages that use it, a composition over the pages that compose it. So adding or
removing types, or connections between them, can rearrange the city; manual pinning is not
available.

## Present the city in a meeting

Press P, or choose Present in the toolbar, to show the schema to a room. Presentation mode takes
the whole screen where the browser allows it. A backoffice that is not allowed to go full screen,
or a link opened with `present=1`, fills the window instead; press P twice for full screen. The
toolbar and the Reset view button go, and the names over and on the city, the 2D views, the
legends and the inspector are drawn 1.4 times larger so they read on a projector. The names printed
on the boards keep their larger size longer as the camera comes closer, and the overview still
prints every name that reads.

Move the mouse and a slim bar appears at the top right with the views, Search and Leave
presentation. It fades when the mouse rests, and Tab reaches it at any time.

Selecting a type shows a caption card in the bottom-left corner instead of the inspector: its name
and role, how much content it has, and how many types it has in each relationship. Details opens
the full inspector over the view, and the camera frames on the whole screen either way. In the 2D
views the last rows scroll clear of the card. Closing the card, or clicking bare ground, puts the
type down and keeps focus, as it does outside presentation; Leave focus on the card, or Home,
leaves it.

Escape closes Details first, then leaves presentation with the focus, the selection and the view
kept. Leaving full screen the browser's way leaves presentation too. Focus, Impact, Show in city,
the change layer and lenses all work as they do outside it. A typical run: the city overview,
Search for a type and Enter to focus it, I for its Impact and Show in city, then M for the Matrix.

![Presenting Home's neighbourhood: no toolbar, larger names, the caption card and the bar a mouse move brings back.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/present.png)

## Navigate the city

The city stands in a 3D world with a sky, a horizon and a ground that runs out to it. It opens on a
raised three-quarter view of the whole city, and from there you can orbit, pan, dolly toward any
point and come down to street level. Focusing a type, leaving focus and Home fly the camera to the
new framing. The establishing flight plays on the first visit in a browser only, along with a
short hint over the canvas. If you lose the city, Reset view in the canvas corner frames it again.
The brief opening animation, that flight, and the dialogs and drawers respect reduced-motion
preferences.

The toolbar, the panels and the 2D views work from the keyboard; use Search or the List view to
pick a type without the mouse. Arrow keys move between the view switcher's views and between
tabs, every scrolling area takes focus so it can scroll, opening a type puts focus on its name in
the inspector, and closing the inspector returns focus to what opened it. A screen reader hears
selection, view, layer and focus changes and filter counts as they happen, and the List view is
the city as a table.

| Action | Control |
| --- | --- |
| Orbit | Drag, or [ and ] |
| Tilt | Drag, or Page Up and Page Down |
| Move toward the cursor, or away | Mouse wheel |
| Pan along the ground | Right-drag, Shift-drag (works on a trackpad), W, A, S, D or arrow keys |
| Rise and descend | R, F |
| Move faster | Hold Shift with a movement key |
| Focus selected type | Enter |
| Leave focus, then clear selection | Escape |
| Reframe the city or leave focus | Home, or the Reset view button on the canvas |
| Toggle connection layers | 1, 2, 3, 4 |
| Switch to List, Tree, Matrix or Editor, or back to the city | L, T, M, E |
| Search | ⌘K / Ctrl+K |
| Present full screen, or leave | P, or Escape to leave |
| Show controls | ? |

## Development

See the [development guide](docs/development.md) for build commands, the backoffice watch loop,
API routes, checks, and packaging. The [demo site guide](src/SchemaCity.Site/README.md) covers login
and seeded data. [Product direction](docs/product-direction.md) separates current workflows from
planned features. [PLAN.md](PLAN.md) retains the original implementation notes.

Report problems or suggest improvements in [GitHub issues](https://github.com/thebuilder/umbraco-schema-city/issues).

## Licence

MIT.
