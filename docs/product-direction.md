# Product direction

Schema City should help an Umbraco developer understand a type before changing it. The city gives
a view of the model's structure; the inspector, findings, search, and list provide the details
needed to act on it.

## What works today

Buildings represent Document Types, floors represent property groups, and connections represent
schema relationships. Districts group types by folder and role. Usage is loaded separately from
the schema and changes colours, not building positions.

The current app supports:

- Finding types and property aliases through search or the sortable list.
- Inspecting properties, composition origins, configured targets, and content usage.
- Revealing a type's direct connections across all layers on hover or selection.
- Focusing a neighbourhood and expanding it one relationship step at a time.
- Reviewing configuration findings, following related types, and exporting filtered results.
- Comparing exported schema snapshots while retaining baseline positions for matched types.

The list and inspector must remain useful without the 3D canvas. Opening a type's Umbraco editor
is the handoff from investigation to editing; the visualization itself does not mutate the model.

## Presentation rules

Districts should look like circuit boards, buildings like components, and relationships like
traces. Keep the geometry tied to schema data. Decorative models would compete with the
information encoded by each building.

The opening draws the board outlines, grows the buildings and their outer frames together, then
traces the enabled connections before fading them. Reduced motion skips that sequence. Controls
stay available during the opening, and changing a layer does not restart it.

Structure is the default background layer. Hover and selection reveal direct links across all
layers, while unrelated paths stay quiet. Keep names on the canvas and counts in the inspector.
Focus should make relationships easier to read, not add more permanent markers to the overview.

Iso and Top down preserve the same world coordinates. Both support pan and zoom. A camera switch
must finish at a valid angle even when the developer is already moving with the keyboard.

Routing separates shared paths and avoids buildings where possible. Crossings in a projected
graph are still possible, so the inspector must explain each relationship's endpoints and meaning.
Avoid a welcome card or camera tour that blocks access to search, findings, and the list.

## Workflows to preserve

### Investigate a finding

Open Findings, choose a category, select the type, and inspect the explanation. A missing block
target should expose its key. A duplicate property alias should identify its sources. Developers
can open the type's editor or export the filtered report for a ticket.

### Review a shared type

Search for a composition or Element Type and inspect its users. Focus it to see the immediate
neighbourhood, then expand when the next step matters. Show schema relationships separately from
observed content references. A connection identifies something to review; it does not prove a
code change will break it.

### Review cleanup candidates

An unused Document Type has no counted content in the usage snapshot. An unused Element Type has
no configured block-editor use in the schema snapshot. Neither check accounts for every consumer
in custom code, migrations, external systems, or stored block values. Show the evidence and its
timestamp rather than describing a type as safe to delete.

### Compare schema revisions

Export a snapshot before a schema change, then import it as a baseline later or in another
environment. Review added and removed types, property and group changes, and changed relationships.
Keep matched buildings at their baseline positions. Snapshot import must remain a comparison
operation, with no schema changes applied to Umbraco.

## Planned features

These are proposals, not current capabilities, in priority order.

1. Trace transitive dependencies. Show composition users, block hosts, and allowed-child paths
   separately, with direction and cycle handling. Let the developer choose relationship kinds
   and depth. Explain each path rather than assigning a single impact score.
2. Check root reachability. Find chains of Document Types that cannot be reached from any allowed
   root. The current dead-end check catches types with no allowed parent; it misses rootless
   chains whose descendants have parents. Explain exclusions for compositions and Element Types.
3. Investigate properties and Data Types. Search by property editor or Data Type, list affected
   properties and types, and link to the Data Type editor where Umbraco provides a supported route.
4. Record review decisions. Let a team mark a finding as intentional with a reason. Tie that
   decision to the relevant schema state so a later change reopens the check. Store decisions
   separately from the Umbraco schema.

Manual pinning and saved layouts could build on the baseline positions used by comparison.
Decorative models, traffic simulations, and scores can wait. Work that helps explain a schema
change or catch a configuration mistake comes first.
