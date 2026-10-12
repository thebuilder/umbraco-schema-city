# Schema City guide

Every view, check and control in detail. For what Schema City is and how to install it, see the
[README](../README.md).

## Contents

- [Investigate a type](#investigate-a-type)
- [Review findings](#review-findings)
- [Check content usage](#check-content-usage)
- [Move between views](#move-between-views)
- [Use the List view](#use-the-list-view)
- [Follow the creation tree](#follow-the-creation-tree)
- [Compare types in a matrix](#compare-types-in-a-matrix)
- [Read a type as an editor sees it](#read-a-type-as-an-editor-sees-it)
- [Investigate a Data Type](#investigate-a-data-type)
- [Trace the impact of a change](#trace-the-impact-of-a-change)
- [Compare schema snapshots](#compare-schema-snapshots)
- [Lay out the city](#lay-out-the-city)
- [Present the city in a meeting](#present-the-city-in-a-meeting)
- [Navigate the city](#navigate-the-city)

## Investigate a type

Use Search or `⌘K` / `Ctrl+K` to find a type by name, alias or property alias.

Hover a building to see its direct connections and the names of connected types. The names of
unrelated types dim. Floating labels that would overlap stay hidden until there is room for them.

Click a building to keep its connections visible and open the inspector. Click a related type in
the inspector to select it. Open in editor takes you to the selected Document Type in Umbraco.

The inspector's header names the type, its role (page, composition or Element Type) and how much
content uses it. Its Editor view and Impact buttons open the pages about the type. The inspector
has four tabs:

- **Overview** lists the schema checks for the type, its usage and its related types, with
  content counts once usage has loaded.
- **Properties** shows each group with the composition it comes from, and each property's Data
  Type.
- **Connections** lists every configured connection by kind, and block and picker targets by
  property. References counted in content are listed separately.
- **Impact** lists what a change to the type reaches. See
  [Trace the impact of a change](#trace-the-impact-of-a-change).

Every type opens on Overview, including one you looked at before. The number on a type chip is the
number of content items of that type across the site. Under Observed in content it is the number
of references instead.

Click a connection, or use Explain connections at the end of the Connections tab, to see what it
represents.

### Read the boards and buildings

Each district is a circuit board. It has a core with copper and solder mask over it, rounded
corners with plated mounting holes, and a faint copper pour. A gold finger on a board's edge marks
each lane of connections that leaves it for another board. A via marks each point where a trace
turns.

Each building is built like a chip on that board:

- Its side grows with the square root of its own property count. Size still tracks property count,
  but a few large types do not push the city apart.
- Each slab is one property group, with a gap between groups. A thin board marks where a new tab
  starts. The lit windows are its properties.
- Composed groups are translucent azure. A composition that no content can be created from is made
  of those shells alone.
- Element Types are low amber blocks.
- Pins along the base count direct connections. Allowed parents are on the north edge, allowed
  children on the south, other links out on the east and links in on the west.
- A lit lid means the type has a template. A dot on the roof means it varies by culture, and a
  second dot means it varies by segment.

The Legend button lists these.

### Read the names on the boards

Every type's name is printed on the board beside its building, inside the silkscreen outline round
the part. From the overview most names are already readable. The full name is always in the
floating label and the inspector.

- As many names print as fit without touching, larger types first, then types with more
  content. Their places are worked out once for the layout, so panning, orbiting and hovering
  never move a name.
- Each board prints at one of three sizes, picked by how far away it is. Closer in, the print gets
  smaller and more of each name fits. A little slack stops it switching back and forth, and the old
  and new print cross-fade.
- A name too small to read fades out, and back in once it reads again.
- A name with no room on one line wraps onto two at a word. If it is still too wide, it drops the
  words its board already says, such as Element on the Elements board or Page among pages, then
  whole trailing words behind an ellipsis. It never shortens so far that it could be another name
  on the same board, and nothing is cut inside a word. A name that still does not fit waits until
  you come closer.
- Names keep off the traces where they can. A name that has to lie over a trace gets a patch of
  bare board under it, so the trace reads as passing beneath.
- Names and district names turn to stay readable when you orbit to the far side.
- A related type whose board prints its whole name legibly gets no floating label. The hovered or
  selected type's printed name gives way to its floating label.

![Closer in on the Site board, with whole printed names, vias where traces turn and a gold finger where traces leave for the Microsite board.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/names.png)

### Switch connection layers

Layer switches control the background overview. Hover and selection show direct connections
across all layers, including ones you have switched off.

| Layer | Relationship |
| --- | --- |
| Structure | Which Document Types can be created below another type |
| Compositions | Shared compositions and inheritance |
| Blocks | Element Types configured as block content or settings |
| References | Document Types allowed by configured pickers |

### Focus on a neighbourhood

Focus arranges the selected type and its neighbours together. To focus, double-click a building,
press Enter with a type selected, or choose Focus in the inspector.

- Expand one step adds the next connected types and keeps the existing focused positions.
- Closing the inspector or clicking bare ground clears the selection and stays in focus, so the
  neighbourhood stays on screen.
- Leave focus in the inspector, Escape, Home and Show all leave focus. With a type selected,
  Escape leaves focus first and clears the selection on a second press.
- While focus is on, List, Tree and Matrix show only the focused types. A line above them says how
  many and offers Show all.

![Home in focus mode with its neighbouring types, direct connections and the inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

## Review findings

Findings runs configuration checks on the schema and lists what they find, such as unused types,
duplicate aliases, missing block targets and empty types. Filter by category, select a result, and
inspect it with its related types. The drawer's header says when the schema was read and when the
usage was counted.

Results are grouped by kind in a fixed order, with definite breakages such as broken blocks and
duplicate aliases first. Each group explains its kind once and says what to do next. Each row shows
the type and what is particular to it, such as where an unused type is allowed.

Problems are open and notes are collapsed. Within a group the strongest cases come first, for
example an unused type whose allowed parents have no content either.

### What the checks flag

Only a type an editor can create, at root or under another type, is reported as unused. A type
nothing can create is a dead end, or a pure mixin when something composes it.

The no template note is left out on a type already reported as unused. It is also left out when
more than half of the creatable types have no template, since that schema is headless by design.

- **Unreachable chain.** A type with allowed parents, none of which a root can reach.
- **Culture mismatch.** An invariant type with a property that varies by culture, or with a block
  editor that lists an Element Type that varies by culture.
- **Near-duplicate Data Type.** Data Types whose names match once case, spaces, hyphens and
  underscores are ignored. Each set is one note, on a type that uses the least-used of them. The
  note lists every other type that uses any of them.
- **Overloaded tab.** A tab with more than 20 properties, composed ones included. On a type
  without tabs, a group with more than 20.
- **Empty block.** An Element Type offered as a content block that has no properties. It is a
  note, because a divider or spacer block is often empty on purpose.
- **Orphaned blocks.** Content stores blocks of an Element Type that no block editor lists any
  more. This is a problem. It takes the place of the unused Element Type row once usage has
  loaded, and names the Data Types the blocks are stored in.
- **Unused Data Type.** A Data Type that no property on a Document, Media or Member Type uses, and
  no collection view either. It is a note about the Data Type itself and opens its page. The Data
  Types Umbraco installs itself are left out, since every site has a dozen it never uses.

Once usage has loaded, an unused Element Type row says how many blocks of it content stores. A
broken block row says how many blocks of the missing Element Type content still holds. Rows that
name a Data Type link to its page.

![Findings grouped by kind, broken blocks and duplicate aliases first, each row naming its own evidence.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

Treat a finding as a reason to investigate before you delete anything. An unused Document Type has
no counted content in the usage snapshot. An unused Element Type has no configured block editor
use in the schema snapshot and, once usage has loaded, no stored block counted either. A count
that stopped early says so. Custom code, migrations, external consumers, and media or member
values can still depend on either.

### Export findings as CSV

Export CSV saves the filtered results as one header row and one row per finding, ready for an Excel
or Jira import. The columns are, in order:

- the kind
- the type, with its key, folder, content counts and backoffice path
- the detail, explanation and next step
- related types by name
- Unused branch root, which for an unused type names its topmost unused ancestor, so a branch of
  unused types can go in one ticket
- the filter used, and the schema and usage snapshot dates
- the Data Types the finding names, with names and keys in two columns
- the review status, reason, who decided, when, and whether it reopened

A finding about a Data Type alone leaves the type columns blank and gives the Data Type's
backoffice path.

### Mark a finding as intentional

Mark a deliberate finding as intentional so it stops asking for attention. Examples are a spacer
block with no properties, a mixin kept for one type, or a type an import still reads.

Mark as intentional is on each row, in the inspector's checks and on a Data Type's page. It asks
for a reason of up to 500 characters and records it with your name and the date. The row then
reads "Intentional:" with the reason, and Undo removes the decision.

Hide reviewed is on by default. It takes decided rows out of the drawer, so the list shrinks to
what still needs attention. The header counts both, for example "67 findings, 12 reviewed, 55
open". A row you decide stays in view until the drawer closes.

A reviewed finding goes quiet in the rest of the app too:

- In the List, the Tree and the Data Types list, its dot becomes a hollow grey ring whose label
  starts "Reviewed:".
- The inspector's Overview tab and a Data Type's Findings heading count open findings only, and
  give the reviewed ones separately, for example "1 reviewed". The "!" marks open problems only.
- Reviewed checks stay listed, greyed out, after the open ones, so you can still read the reason
  or Undo it.
- The Unused lens and the Editor page's flagged property rows count open findings only.

A reopened finding counts as open again in all of these.

![A broken block marked as intentional with its reason and Undo, and the reason form open on a duplicate alias.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/review.png)

### When a decision reopens

A decision holds only for the schema as it was when it was made. When the type or Data Type the
finding is about changes, the finding is open again. It shows the old decision and "Reopened: the
type changed since this was decided."

Each decision stores a fingerprint of that type or Data Type. The fingerprint covers its record,
its groups and properties, its templates, and every connection in or out of it, allowed children,
compositions and block targets included. Renaming the type, or a Data Type it uses, reopens the
finding too, since the check errs towards asking again. Saving checks the fingerprint on the
server, so a decision is never recorded against a type that changed after the page loaded.

### Where decisions are stored

Decisions are app data, not schema.

- Each finding gets one row in Umbraco's key-value table (`umbracoKeyValue`), stored as JSON under
  `SchemaCity.Decision.<finding id>`. The package needs no migration, and nothing in the Document
  Types, Data Types or content changes.
- Undo empties the row rather than deleting it, because Umbraco's key-value service has no delete.
- Everyone who opens Schema City on that site shares the decisions. They do not travel with a
  schema snapshot or uSync.
- Recording and undoing need the same Settings section access as the rest of the extension.

## Check content usage

The Lens menu in the footer colours buildings by content count, published share, cultures,
incoming references or unused status. Select a type to read its counts in the inspector.

The Unused lens marks the types that the unused checks in Findings flag. It marks a type as in use
when it has content, a type composes it or a block editor lists it.

Usage loads separately from the schema, so you can explore the model while that request is
pending. Usage is a snapshot, cached on the server for one minute. It is not a live dependency
check.

![The Content count lens with Article selected and its usage totals in the inspector.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

Configured picker connections and observed references between content items are different data.
The inspector's Connections tab reports them separately, under Picker references and Observed in
content.

## Move between views

The header holds what works on the whole schema:

- the view switcher, with City, List, Tree, Matrix and Data Types
- Search, Findings, Compare and the control reference

The chosen view is kept in the URL. Every view except City works without the 3D canvas.

Editor and Impact are the two pages about one type. Open them from the selected type's inspector
with Editor view and Impact, or press E and I. A line over the page names the type and leads back
to the view you came from, with the selection kept. With nothing selected, E and I open nothing and
say "Pick a type first" instead. A link with `view=editor` or `view=impact` and a type still opens
that page. Without a type it opens the city.

The footer says how many types the city has and when the schema and the usage were read. It gives
the time if that was today and the date otherwise, in your own time zone. It says "usage loading"
while that request is still out.

In the City the footer also holds the City's own tools, Layers, Group, Lens, Legend and Reset view.
Present is there in every view. Where the workspace is narrower than about 960 px, the City's tools
fold into one City tools menu.

## Use the List view

List shows the same types in a searchable, sortable table, and works without the 3D canvas. Click
a column heading to sort by it, or click a type to open the inspector.

Each type's role is shown in the city's colours, and a pink dot marks a type with a problem
finding. Content counts are blank for Element Types and for compositions nothing creates, as on the
inspector's chips, since neither holds content of its own.

![The type list sorted by own property count, largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

## Follow the creation tree

Tree shows what an editor can create under each root. It starts at each type allowed at root and
follows the allowed-child rules.

- A type allowed under two parents appears under both.
- A type that already appears higher in the same branch is marked and not expanded again.
- Once usage has loaded, each type shows its content count across the whole site, on its first row
  only. A repeat of the type further down says same type.
- Types without content are drawn quieter, so the branches where content lives stand out.
- A pink dot marks a type with a problem finding, and its tooltip names the checks.

Below the tree, a list shows the Document Types that no root can reach, with the types they are
allowed under. This shows a chain that only hangs off another unreachable type. Element Types and
compositions that nothing can create are left out of that list.

![The creation tree from the three root types, with Home selected under Site and the unreachable types below.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/tree.png)

## Compare types in a matrix

Matrix has two grids.

**Compositions** shows which types use which compositions, and marks a composition that arrives
through another one. Umbraco records a parent type as a composition of the types that inherit from
it, so a parent appears as a column too, marked parent.

**Data Types** shows how many of each type's own properties use each Data Type. Each column is
headed by the Data Type name, with the property editor alias and the start of the Data Type key
below it, so two Data Types with similar names can be told apart. Rows are sorted by name, and
columns sort by usage or by name.

![The compositions matrix, with Seo Composition used by most page types.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/matrix.png)

## Read a type as an editor sees it

Editor draws the selected type as tabs and groups, the way editors see it. Choose Editor view in
the inspector, or press E, to open the selected type here.

- Tabs and groups come in the order the schema lists them.
- Each property shows its name, alias, Data Type, mandatory marker and culture variance. The
  property editor alias shows on hover, and a screen reader reads it after the Data Type.
- A group from a composition names the composition once on its header and starts folded, so the
  properties the type adds itself stand out. The view opens on the first tab that has any of
  them. Expand composed groups opens the folded groups.
- The type's checks sit above the tabs, and a tab with more than 20 properties is marked.
- Rows the checks are about say so in pink. These are both properties of a duplicate alias, with
  the editor each one uses, a block property that lists a deleted Element Type, and the properties
  of a culture mismatch. A folded group with such a row carries a dot.

![Home on the Editor page, opened on the Content tab where its own properties are, with its checks above the tabs.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/editor.png)

## Investigate a Data Type

Data Types lists every Data Type in the site, unused ones included. Choose one to read its page
beside the list, or under it when the room is narrow. The URL keeps it as `dataType=<key>`.

Each row shows the Data Type's editor, how many properties use it, on how many types, and the
blocks content stores in it. A dot marks one that a check flagged. Sort by any column, and filter
by name, editor or key.

The Data Types Umbraco installs itself are marked built-in. They stay out of the list until you
tick Show built-in, except one that a link has opened.

Every Data Type name elsewhere in the app opens this page:

- the column headings of the Matrix's Data Types grid
- the Editor page's property rows
- the inspector's Properties tab, and its block and picker sections
- Data Type changes in Compare
- findings that name a Data Type

### Read a Data Type's page

The page shows the editor's UI alias, its editor alias and its key. Open in editor opens the Data
Type in the backoffice.

- A block editor lists the Element Types it offers as content and as settings, each with the
  blocks of it that content stores. You can see what a move or a removal would touch before you
  make it. An offered Element Type that nothing stores has a dashed edge and says none stored. A
  key that no longer resolves says missing type. An Element Type that content still stores but
  the editor no longer offers gets its own row.
- A picker lists the Document Types it allows.
- Used by lists every type with a property on it, with the property aliases, the composition a
  composed one comes from and the type's content count. Choose a type to open it in the
  inspector.
- The page ends with the stored block totals, a few configuration values such as a block list's
  limits, and the findings about the Data Type.

Show in city switches to the City and lights the buildings that use the Data Type. Clear over the
canvas, or choosing a lens, ends it.

Stored blocks are counted with the usage snapshot. The count covers the latest version of every
document outside the recycle bin, published or draft, nested blocks included. It reads the stored
JSON directly and stops after 50,000 values or five seconds. The page then says the numbers are a
lower bound. Media and member values are not counted.

![SC Page Grid's page, with what content stores of each Element Type, two offered but never stored, and the types that use it.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/datatypes.png)

## Trace the impact of a change

Impact lists every type a change to the selected type reaches, with its content count. The
inspector's Impact tab lists them by group. Impact at the top of the inspector, or I, shows the
full trace in place of the view.

The trace follows four relationships, each with its own toggle:

- **Compositions and inheritance.** Every type that gets the type's properties, directly or
  through a type that inherits or composes it. Press Release reaches Seo Composition through
  Article.
- **Blocks.** For an Element Type, every type whose properties offer it, with the property and its
  Data Type. Then the types that inherit those properties, and the blocks that nest it. The header
  says how many blocks of it content stores, per Data Type.
- **Allowed children.** The types that allow it as a child and would lose a creation option. Also
  the allowed children that only it leads to from a root, which nobody could create if it were
  removed.
- **Pickers.** The types whose picker properties allow it, and the types that carry those
  properties.

Depth stops the trace after one step or two, or follows it all the way. Direction turns the trace
round to what the type depends on. That is its compositions, the blocks it offers, the types
allowed under it and the types its pickers allow.

Each row writes out its paths in words, shortest first, up to three, such as "Press Release
inherits Article, which composes Seo Composition". It also says whether the type is reached
directly. A path never visits a type twice, so cycles end. The totals at the top count each type
once.

### Check a property alias

Planned or existing alias checks a property alias.

- An alias the type has is traced from the type that declares it, and lists every type it lands
  on.
- A new alias is checked against every type it would land on if added here.

Either way, a type that already has the alias from another source is a collision. This is the trap
in adding a property to a composition. Umbraco compares aliases without case, and a type cannot
hold one twice. On the Editor page, each property row's Impact opens the trace with its alias
filled in.

### Share the trace

- Copy as Markdown copies a ticket-ready summary. It has the start type, the relationships and
  depth, the snapshot dates, the totals, a table per group with each path and content count, and
  the collisions. Where the clipboard is blocked, the text is shown selected instead.
- Export CSV writes one row per type per group and one per collision. It uses the same escaping and
  spreadsheet formula protection as the findings export.
- Show in city lights the type and everything the trace reaches.

A trace lists configured relationships to review. It does not tell you a change is harmless, or
that it breaks something. Code, templates and stored values outside the schema can depend on a
type too.

![Seo Composition's impact: 37 types and 188 content items, each with its path, and a seoTitle collision on Dup Alias Page.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/impact.png)

## Compare schema snapshots

Compare shows what changed between the current schema and a saved snapshot. Open Compare and
export the current schema before you make a change. The file is named after the site and the day,
such as `schema-city-snapshot-example-com-2026-10-07.json`, and records the host it came from.
Later, import that file as a baseline, or import a snapshot from another environment.

Snapshot import is for review and does not apply changes to Umbraco. Comparison covers schema
configuration only. It does not compare content usage or dependencies in custom code.

### Causes and side effects

The comparison is a list of causes. A cause is one type with edits of its own. Those edits are:

- the type was added or removed
- properties were added, removed or changed, or a property got a new Data Type
- its groups or tabs changed
- its compositions, allowed children, or block or picker targets changed

The types that only changed because of a cause are its side effects, and sit under it:

- every type that composes or inherits a composition whose properties changed
- every Element Type whose incoming block relationship changed because a host's block list did
- every type whose incoming picker or allowed-child relationship changed, and every parent that
  gained or lost an allowed child because that child type was added or removed

A type with an edit of its own and a side effect too stays a cause, and says what else it is a
side effect of. Nothing is dropped. Every line of the comparison sits under exactly the causes that
explain it, and a line nothing explains counts as its type's own edit. The summary reads, for
example, "4 causes, 48 side effects, 1 unplanned", where the old flat list said "1 added, 51
changed".

### Mark what you planned

Tick each cause you planned with its Planned box, use Mark all as planned, or Paste a plan as a
list of type aliases. Show unplanned only then leaves the changes nobody asked for. The plan lasts
as long as the baseline does.

- Copy as Markdown gives a ticket-ready list, with both snapshots' hosts and dates, the totals,
  each cause ticked when planned, and its side effects nested under it.
- Export CSV gives one row per line, with the cause it belongs to, whether it is the cause's own
  edit or a side effect, and whether it was planned.

### See the changes in the city

While a baseline is loaded, the city shows a change layer and dims everything else:

- added types are azure
- types changed by their own edit are amber with a ring
- side effects are a quieter amber
- removed types are outlines where they stood

Choosing a lens replaces the change layer until the lens is off again. Show in city, from the
Impact page or a Data Type, replaces it until you clear it. The List view gets a Change column,
sortable and filterable, with a row for each removed type.

Matched buildings keep their baseline positions. New types appear on separate added boards.

![Compare against a baseline from before four planned edits, three marked planned, and Press Release open on the types that changed only because it was added.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/compare.png)

## Lay out the city

The Group control in the footer chooses how the city is cut into districts. The choice is kept in
the URL.

- **Structure** is the default. It gives each type allowed at root its own board with everything
  it can create.
  - Inside a board each parent forms a neighbourhood with its allowed children beside it, so
    structure traces stay short.
  - A type that several roots or parents allow sits with the one that a breadth-first walk from the
    roots reaches it from first. The traces show the rest.
  - Element Types share one board, in one group per block editor that offers them. A type offered
    by several editors goes with the one that offers it as content most often.
  - Compositions have their own board, and the types no root can reach go on Unreachable.
- **Folders** gives each top-level folder a district, as earlier versions did.

In both, a district's place and the order of its loose types follow their connections. An Element
Type sits under the pages that use it, and a composition over the pages that compose it.

Outside comparison mode, the same schema always gives the same layout. Adding or removing types,
or connections between them, can rearrange the city. You cannot pin buildings by hand.

## Present the city in a meeting

Press P, or choose Present in the footer, to show the schema to a room.

- Presentation mode takes the whole screen where the browser allows it. A backoffice that is not
  allowed to go full screen, or a link opened with `present=1`, fills the window instead. Press P
  twice for full screen.
- The header and the footer go.
- The names over and on the city, the 2D views, the legends and the inspector are drawn 1.4 times
  larger, so they read on a projector. The names printed on the boards keep their larger size
  longer as the camera comes closer, and the overview still prints every name that reads.

Move the mouse and a slim bar appears at the top right, with the views over the whole schema,
Search and Leave presentation. It fades when the mouse rests, and Tab reaches it at any time.

Selecting a type shows a caption card in the bottom-left corner instead of the inspector. It
gives the type's name and role, how much content it has, and how many types it has in each
relationship. Details opens the full inspector over the view. Editor and Impact open from the
card's Details. The camera frames on the whole screen either way. In the 2D views the last rows
scroll clear of the card.

Closing the card, or clicking bare ground, puts the type down and keeps focus, as it does outside
presentation. Leave focus on the card, or Home, leaves focus.

Escape closes Details first, then leaves presentation and keeps the focus, the selection and the
view. Leaving full screen the browser's way leaves presentation too. Focus, Impact, Show in city,
the change layer and lenses all work as they do outside it.

A typical run:

1. Start on the city overview.
2. Search for a type and press Enter to focus it.
3. Press I for its Impact, then Show in city.
4. Press M for the Matrix.

![Presenting Home's neighbourhood with no header or footer, larger names, the caption card and the bar a mouse move brings back.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/present.png)

## Navigate the city

The city stands in a 3D world with a sky, a horizon and a ground that runs out to it. It opens on a
raised three-quarter view of the whole city. From there you can orbit, pan, dolly toward any point
and come down to street level.

Focusing a type, leaving focus and Home fly the camera to the new framing. The establishing flight
plays only on the first visit in a browser, along with a short hint over the canvas. If you lose
the city, Reset view in the footer frames it again. The brief opening animation, that flight, and
the dialogs and drawers respect reduced-motion preferences.

### Use the keyboard and a screen reader

The header, the footer, the panels and the 2D views work from the keyboard. Use Search or the List
view to pick a type without the mouse.

- Arrow keys move between the view switcher's views and between tabs.
- Every scrolling area takes focus so it can scroll.
- Opening a type puts focus on its name in the inspector. Closing the inspector returns focus to
  what opened it.
- A screen reader hears selection, view, layer and focus changes and filter counts as they happen.
- The List view is the city as a table.

### Controls

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
| Reframe the city or leave focus | Home, or Reset view in the footer |
| Toggle connection layers | 1, 2, 3, 4 |
| Switch to List, Tree or Matrix, or back to the city | L, T, M |
| Open the selected type's Editor or Impact page, or go back | E, I |
| Search | ⌘K / Ctrl+K |
| Present full screen, or leave | P, or Escape to leave |
| Show controls | ? |
