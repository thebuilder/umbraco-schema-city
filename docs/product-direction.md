# A content model you can inspect

Schema City should help an Umbraco developer answer a question before it asks them to explore a city. The useful promise is: see how your content model fits together, find configuration problems, and investigate a type before changing it.

The city is a spatial index. A building identifies a Document Type, its floors represent property groups, and its circuits describe schema relationships. Folders and type roles organise districts. The inspector and list supply the exact aliases, properties, counts, and editor links needed to act on that overview.

## Review of the first version

The existing implementation already has most of the data needed for a useful review tool: separate schema and usage snapshots, property origins, block targets, composition users, selectable findings, search, focus mode, and a canvas-free list. Preserve those paths. A developer should be able to work without using the camera at all.

The initial presentation has three weaknesses:

- Buildings rise onto an already visible stage, while connection layers disappear immediately. The pieces do not share one visual transition.
- Structure lanes clamp together in busy streets, and other ground links use the same routes. This can suggest relationships that do not exist. Route geometry and direction must remain readable as layers change.
- Findings mostly identify a type. Developers also need the related composition or missing block key, the checks alongside its properties, and a report they can take into a ticket.

## Presentation

Treat the world as the inside of a computer. Districts read as circuit boards, buildings as components, and relationships as traces. Keep the geometry generated from the schema; decorative buildings would compete with the information encoded in each type.

Use a brief opening sequence: stage outlines, solid districts and buildings, then connections. Keep controls available throughout. Respect reduced motion and do not replay the opening just because a developer toggles a layer. Hiding a layer should reverse its material transition so the change has a visible cause.

Default to structure relationships. Displaying every relationship at once overwhelms even a medium schema. The legend must explain edge direction, and selecting or focusing a type must give a readable local view. Routing can avoid coincident paths and building intersections, but arbitrary graphs will still have crossings in projection.

Give the unselected view a compact purpose statement and a model count. Search, findings, and list view should be visible starting points. Avoid a blocking welcome screen or a compulsory camera tour.

## Developer workflows

### Investigate a check

Open Findings, filter to a category, select the host type, inspect its checks and related types, and open the Umbraco editor. A broken block configuration should expose the missing key. A duplicate alias should expose the contributing compositions. Export the filtered checks for a ticket or team review.

### Review a shared type

Search for a composition or Element Type, select it, and inspect the types that use it. Focus its neighbourhood when the whole city becomes crowded. Keep direct schema relationships distinct from content-instance references. A relationship identifies something to review; it does not prove that a code change will break it.

### Review cleanup candidates

Use the usage lens and findings to find types worth investigating, then inspect their relationships and content counts. An unused Document Type has no counted content in the usage snapshot. An unused Element Type has no configured block-editor use in the schema snapshot. Neither conclusion accounts for every possible consumer in custom code, migrations, external systems, or stored block values.

## Next features, in order

1. **Schema comparison.** Save a versioned snapshot, compare another environment or a later revision, and list added or removed types, properties, compositions, and allowed targets. Highlight changed buildings without moving unchanged ones. Begin with explicit JSON import/export and alias/key matching; keep environment authentication out of the first slice. This would make the city useful during deployments and code reviews.
2. **Transitive dependency review.** Trace composition and inheritance users separately from block hosts and allowed-child rules. Show the actual path and direction for each result, handle cycles, and let the user bound the relationship kinds. Avoid a single unexplained “blast radius” score.
3. **Root reachability.** Detect whole chains of Document Types unreachable from any allowed root. The current dead-end check only catches a type with no allowed parent; it misses a rootless chain whose descendants have parents. Traverse allowed-child edges, retain cycles, and explain exemptions for compositions and elements.
4. **Property and Data Type investigation.** Search an editor or Data Type and list the affected properties and types. Open the actual Data Type editor when the host provides a supported route. This would help before changing block configurations or migrating property editors.
5. **Review decisions.** Let a team mark a finding as intentional with a reason. Key decisions to the finding and relevant schema state so a later change reopens the check. Keep these annotations separate from Umbraco schema mutations.

Defer model packs, avatars, weather, traffic simulations, and achievement scores. The next investment should help someone explain a schema change or avoid a configuration mistake. Camera pinning and saved layouts become worthwhile alongside schema comparison, when a stable visual reference has a concrete use.
