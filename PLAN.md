# Schema City, implementation plan

An Umbraco 17 and 18 backoffice extension that renders the content model as an isometric
Three.js city. Document Types are buildings, allowed-child rules are roads,
compositions are bridges, Element Types live in their own district, and a Usage
lens recolours the same city by what the content actually does.

This document turns the design brief into decisions, a data contract, a repo
layout, and ordered milestones. The brief's product reasoning is taken as
settled and not repeated here.

---

## 0. Build rules

These apply to every commit, every file and every generated sentence.

- **Ponytail governs the code.** Climb the ladder before writing anything: does it need to exist, is it already in the repo, does the stdlib or the platform do it, does an installed dependency do it, can it be one line. No interface with one implementation, no config for a value that never changes, no scaffolding for later. A deliberate corner gets a `ponytail:` comment naming the ceiling and the upgrade path. Non-trivial logic leaves one runnable check behind.
- **Unslop governs the words.** Code comments, README, UI copy, error messages, commit messages and this plan. No em dashes, no "not just X but Y", no rule of three, no colons as connectors, no puffery, no filler. Say what the thing does, in plain words, with the number when there is one.
- fsn's conventions carry over where they do not conflict: why-comments in full sentences, colocated behaviour tests, no snapshot tests, lowercase conventional commit prefixes.

---

## 1. Decisions

### Settled by the brief

- Isometric 2.5D map with an orthographic camera by default; free perspective is an opt-in Explore toggle.
- One node per Document Type. Geometry comes from the schema only, never from usage, so the map is spatially stable.
- Relationship layers, never all edges at once: `Structure`, `Compositions`, `Blocks`, `References`, plus a `Usage` lens.
- Selecting a node fades everything unrelated and opens an inspector sidebar. Double-click flies into the node (focus mode).
- Home is a Settings sidebar entry (Advanced group) that opens a full-area workspace. A `Relationships` workspace view on the Document Type editor opens the same map pre-focused.
- Lit wrappers around a React application, Three.js through React Three Fiber, following the v17 extension architecture. Detailed data lives in the inspector, not floating in the scene.
- Reuse fsn's ideas and small mechanisms; do not adapt fsn into a third adapter and do not extract a shared framework before a second graph exists.
- Content mode (real content instances) is out of v1.

### Made here, and why

1. **Custom backend endpoint from the first milestone**, not a Management API-only MVP.
   The `umbraco-extension` template ships a controller, so the marginal cost is one file. Its Swagger registration and generated client were removed in M0; see section 5. The Management API needs one request per Document Type to get properties and compositions, plus one per Data Type to decode block configuration, which is 100+ calls on a mid-size install. One aggregated call also means the graph builder is a pure C# service with unit tests. The Management API remains the fallback if a host refuses custom controllers, but it is not the primary path.

2. **Two endpoints, not one.** `graph` (schema, fast, cached until a Content Type or Data Type changes) and `usage` (counts, references, slower, short TTL). The city renders from `graph` immediately and the usage lens lights up when `usage` arrives.

3. **Layered layout via `@dagrejs/dagre`.** Small, synchronous, deterministic. ELK is about 1.4 MB and wants a Web Worker. If dagre looks bad on a real schema, swap the one file that calls it. No adapter interface until a second engine exists.

4. **Findings (unused types, dead ends, duplicate aliases, complexity score) are computed client-side** in pure TypeScript from `graph` + `usage`. They are cheap, easy to test with fixtures, and it keeps the backend to data collection.

5. **Deterministic input order.** Nodes and edges are sorted by alias before layout, so the same schema always produces the same city. This is the FSN "spatial memory" property.

6. **A standalone dev harness** (`Client/dev/`) renders the scene from fixture JSON without Umbraco running. Most scene and layout work happens there; Umbraco is for integration.

7. **Support Umbraco 17 LTS and 18+.** NuGet dependency `Umbraco.Cms.Web.BackOffice` in the range `[17.0.0, 19.0.0)`, one code base, CI builds and runs the seeded site on both majors from M0. The three Umbraco-specific frontend imports live in one file so a breaking change in 18 or 19 is a one-file fix.

8. **MIT licence, public repository from M1.**

9. **Settings tool only, gated by Umbraco's own permissions.** The menu item is conditioned on the Settings section and both endpoints require `SectionAccessSettings`, so administrators control access per user group through the normal Users area. No custom permission or editor-facing view in v1.

10. **The seeded schema is the test bed.** No real project is required. The seeder plants known findings (orphans, dead ends, an unused element type, a broken block reference) so tests and milestone exits assert against a deterministic expected set.

11. **React inside the Lit wrapper, with R3F and afterglow.** React 19 renders inside the Lit workspace element, the scene runs on React Three Fiber and drei, and the panels are shadcn components on base-ui from the afterglow registry, with Tailwind v4. The reason is the ecosystem around the scene. Event traffic was not the deciding factor, since a store handles that identically in Lit or React. R3F and drei give declarative meshes, camera controls and instanced picking, and shadcn gives the panel chrome, so there is less code we own. No state library until one is needed.

12. **Home is a sidebar workspace, not a dashboard.** A Settings sidebar entry in the Advanced group, next to Log Viewer and Relations, opening a full-area workspace at `/umbraco/section/settings/workspace/schema-city`. A dashboard would share the section landing page with everything else there; the workspace gives the city the whole content area.

---

## 2. Repository layout

```
schema-city/
  PLAN.md
  README.md
  LICENSE                          MIT
  SchemaCity.sln
  src/
    SchemaCity/                      Razor Class Library, the NuGet package
      SchemaCity.csproj
      Constants.cs                   API name, route prefix, aliases
      Composers/
        SchemaCityComposer.cs        registers the builder singleton and its cache-clearing handlers
      Api/
        GraphController.cs           GET graph
        UsageController.cs           GET usage
      Graph/
        SchemaGraphBuilder.cs        IContentType[] + IDataType[]  ->  SchemaGraph
        BlockEditorInspector.cs      decodes Block List / Grid / RTE / MNTP configs
      Usage/
        UsageCollector.cs            counts, cultures, relations, aggregated by type
      Models/                        DTOs mirrored 1:1 by the TS types
      wwwroot/App_Plugins/SchemaCity/   Vite output + umbraco-package.json
      Client/
        package.json  vite.config.ts  tsconfig.json  components.json
        public/umbraco-package.json
        src/
          api.ts                        one typed call per endpoint through umbHttpClient
          entry-workspace.tsx           Lit wrapper: fetches, mounts the React root, adopts the stylesheet
          entry-document-type-view.tsx  Lit wrapper for the Document Type editor, mounts App focused on the type
          model/                        graph types, indexes, findings, search   (no DOM, no three)
          app/                          React: App, layout, scene (R3F), panels, styles.css (Tailwind + afterglow theme)
          components/ui/                afterglow primitives, copy-in via the shadcn CLI
        dev/
          index.html  main.ts        harness, loads fixtures without Umbraco
          fixtures/*.json            graph and usage fixtures; the medium ones are exported by the seeder
    SchemaCity.Site/                 throwaway Umbraco 17 site referencing SchemaCity
      Seed/SchemaSeeder.cs           dev-only: creates ~80 Document Types on first boot
  tests/
    SchemaCity.Tests/                xUnit: graph builder, block inspector, usage aggregation
```

Scaffold command (verified against the v17 docs):

```bash
dotnet new umbraco-extension -n SchemaCity -ex
```

The `-ex` example gives a controller, a Swagger composer and a dashboard. Keep the controller shape, delete the Swagger and generated-client wiring (see section 5), replace the dashboard with the workspace. There is no controller base class until a second controller exists; `GraphController` carries the route and API attributes itself.

Naming: NuGet id `SchemaCity`, namespace `SchemaCity`, route `schema-city`, custom element prefix `schema-city-`, extension alias prefix `SchemaCity.`.

---

## 3. Data contract

The backend returns a domain-neutral graph. The frontend never sees Umbraco service types.

```ts
// model/types.ts, mirrored by C# records in Models/

export type SchemaGraph = {
  generatedAt: string;
  folders: SchemaFolder[];
  nodes: SchemaNode[];
  edges: SchemaEdge[];
};

export type SchemaFolder = { id: string; name: string; parentId: string | null };

export type SchemaNode = {
  id: string;                      // Document Type key (guid)
  alias: string;
  name: string;
  icon: string;                    // "icon-document", colour suffix stripped
  iconColor: string | null;        // "color-blue" if present
  folderId: string | null;
  isElement: boolean;
  allowedAsRoot: boolean;
  variesByCulture: boolean;
  variesBySegment: boolean;
  description: string | null;
  groups: PropertyGroup[];         // ordered tabs/groups, composed ones marked
  ownPropertyCount: number;
  composedPropertyCount: number;
  templates: { id: string; alias: string; name: string; isDefault: boolean }[];
};

export type PropertyGroup = {
  id: string; alias: string; name: string; type: "Tab" | "Group";
  parentAlias: string | null;
  fromCompositionId: string | null;   // null = own
  properties: SchemaProperty[];
};

export type SchemaProperty = {
  alias: string; name: string;
  dataTypeId: string;
  editorAlias: string; editorUiAlias: string | null;
  mandatory: boolean; variesByCulture: boolean;
  fromCompositionId: string | null;
  /** Element Types this property can contain (block editors) or point at (pickers). */
  targets: { nodeId: string; role: "content" | "settings" | "picker" }[];
};

export type EdgeKind =
  | "allowedChild"    // from parent type -> to child type
  | "composition"     // from user -> to composition
  | "inherits"        // from child -> to parent (ParentId, also present as composition)
  | "block"           // from host type -> to element type, via propertyAlias
  | "reference";      // from picker host -> to allowed target type, via propertyAlias

export type SchemaEdge = {
  kind: EdgeKind; from: string; to: string;
  propertyAlias?: string; role?: "content" | "settings";
};

export type UsageReport = {
  generatedAt: string;
  byType: Record<string, TypeUsage>;         // keyed by node id
  references: { fromType: string; toType: string; count: number }[];  // instance-level, aggregated
};

export type TypeUsage = {
  total: number; published: number; drafts: number; trashed: number;
  rootInstances: number;
  cultures: string[];                          // cultures with at least one variant
  lastEdited: string | null;
};
```

Findings are derived in `model/findings.ts`:

| Finding | Rule |
| --- | --- |
| Unused type | not element, zero instances. Needs usage |
| Unused element type | element, no incoming `block` edge |
| Structural dead end | not `allowedAsRoot`, no incoming `allowedChild`, not element, and nothing composes it. This absorbs the unused-composition kind, which is dropped |
| Duplicate property alias | two compositions, or a composition and the type's own properties, contribute the same property alias. This is the composition bug that breaks editing |
| Broken block reference | a block target that resolves to no node. The block inspector emits this instead of silently dropping the edge |
| No properties | zero own and zero composed properties |
| No template | not element, placeable, zero allowed templates, and only when at least one type in the schema has a template. Note |
| Pure mixin | composed by something, never root, never a child, never a block target. Note |
| Complexity | `own + composed properties + 2*compositions + block targets`, in tiers cut relative to the schema's busiest type. Only the top tier is reported. Note |

Every finding carries a stable id (`kind:nodeId`), a severity (problem or note) and the node it points at, so the drawer can filter and link. Problems sort before notes. The rules that read usage are skipped when usage is absent.

---

## 4. Backend: what comes from where

All of this is in-process and runs on the host site. No new tables.

| Need | Source |
| --- | --- |
| All Document Types | `IContentTypeService.GetAll()` |
| Folders | `IContentTypeService.GetContainers(Array.Empty<int>())`, matched via `contentType.ParentId` / `Path` |
| Identity, icon, element, root, variations, description | `IContentType` properties; icon string split on space for the colour suffix |
| Own groups and properties | `PropertyGroups`, `NoGroupPropertyTypes`. Group nesting is encoded in the alias as `tabAlias/groupAlias`, decoded with `PropertyGroupExtensions.GetParentAlias` and `GetLocalAlias`. There is no parent field on `PropertyGroup` |
| Composed properties and their origin | `CompositionPropertyTypes` minus own `PropertyTypes` by id gives the composed set. For origin, walk the whole composition chain breadth first, direct compositions first, deduplicated by key, mapping each composition's own property ids to that composition. One level misses properties composed through an inherited parent |
| Inheritance | `ParentId` pointing at another content type rather than a container; emit `inherits` and keep the matching `composition` edge |
| Allowed children | `AllowedContentTypes` (`ContentTypeSort.Key`) |
| Templates | `AllowedTemplates`, `DefaultTemplate` |
| Block and picker targets | `IDataTypeService.GetAllAsync()`; inspect `EditorAlias` against `Constants.PropertyEditors.Aliases.BlockList`, `BlockGrid`, `RichText`, `MultiNodeTreePicker`; read `ConfigurationObject` (`BlockListConfiguration.Blocks[].ContentElementTypeKey` / `SettingsElementTypeKey`, `BlockGridConfiguration.Blocks[]`, `RichTextConfiguration.Blocks`, `SingleBlockConfiguration`, `MultiNodePickerConfiguration.Filter` as comma separated aliases). Nested block configuration can recurse, so the walk keeps a visited set of Data Type ids and one of content type keys. A configured Element Type key that resolves to nothing becomes a broken-block-reference finding |
| Content counts | One SQL query for the whole install. It starts from `umbracoNode` filtered to the Document Type object type and left joins `umbracoContent`, the instance's own `umbracoNode` row and `umbracoDocument`, so a type with zero content still gets a row. Grouped by type it gives total, published, drafts, trashed and root instances. `cmsContentType` is not needed. The Document Type key is `umbracoNode.uniqueId` and `umbracoContent.contentTypeId` is that node id. `nodeObjectType` is compared as a Guid, not as text, because SQLite and SQL Server disagree on the text form |
| Root instances | level 1 nodes with `trashed = 0`, grouped by type, in the same counts query. The recycle bin's children are level 1 too |
| Cultures | `umbracoDocumentCultureVariation` joined to `umbracoLanguage`, `available = 1`, grouped by type and ISO code. Always run, because an empty culture variation table costs nothing to scan |
| Instance references | SQL over `umbracoRelation` filtered to the `umbDocument` relation type, both ends resolved to their content type key and grouped. Not `IRelationService`. The referencing document is the relation's parent, so parent maps to `fromType` |
| Last edited | `MAX(versionDate)` per type from `umbracoContentVersion`, kept as its own query because joining versions multiplies rows |

Caching and invalidation:

- The builder keeps the last `SchemaGraph` in a field and is registered as a singleton. Its two `INotificationHandler` registrations for `ContentTypeCacheRefresherNotification` and `DataTypeCacheRefresherNotification` are factory registrations that resolve that same singleton. Umbraco's `AddNotificationHandler` registers handlers as transient, which would clear a cache nobody reads. Those notifications fire on every server after any save, delete or move, so load balancing needs nothing extra.
- `UsageCollector` caches the report in a field for 60 seconds. `?refresh=true` bypasses. No lock around the cold path; the four queries are cheap.

Authorization: `[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]` on both controllers. The menu item is only registered under Settings, and the workspace view is inside the Settings section. Access is therefore whatever the administrator grants a user group for Settings; the package adds no permission of its own.

Resulting routes:

```
GET /umbraco/management/api/v1/schema-city/graph
GET /umbraco/management/api/v1/schema-city/usage?refresh=false
```

---

## 5. Frontend architecture

### Module rules

- One React `App` under `src/app/` is the whole application. It imports nothing from `@umbraco-cms/backoffice`, takes the graph and usage objects and a `focus` id as props, and calls back through props (`onOpenType`). There is no custom element for the map, and there will not be one.
- There is one Lit wrapper per host that mounts that `App`, one for the home workspace and one for the Document Type editor view. The wrappers are the only Umbraco-aware code. They fetch, read the workspace context, resolve icons, and turn `onOpenType` into an editor link through `openTypeInEditor` in `api.ts`, which builds the route from Umbraco's `UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN` and pushes it onto the history.
- The harness renders `App` directly, from fixtures and a query string.
- `model/` stays pure: no DOM, no three.js, no React. Vitest-tested with fixture JSON. The layout functions (dagre to placements, focus layout) live in `app/layout/` and are pure in the same way.
- `components/ui/` holds the copied-in afterglow primitives. They are edited in place; there is no upstream to update from.

### Extension manifests (`public/umbraco-package.json`)

```json
{
  "name": "Schema City",
  "version": "0.1.0",
  "extensions": [
    {
      "type": "workspace",
      "alias": "SchemaCity.Workspace",
      "name": "Schema City Workspace",
      "element": "/App_Plugins/SchemaCity/workspace.js",
      "meta": { "entityType": "schema-city" }
    },
    {
      "type": "menuItem",
      "alias": "SchemaCity.MenuItem",
      "name": "Schema City Menu Item",
      "weight": 50,
      "meta": {
        "label": "Schema City",
        "icon": "icon-map-alt",
        "entityType": "schema-city",
        "menus": ["Umb.Menu.AdvancedSettings"]
      },
      "conditions": [{ "alias": "Umb.Condition.SectionAlias", "match": "Umb.Section.Settings" }]
    },
    {
      "type": "workspaceView",
      "alias": "SchemaCity.DocumentTypeView",
      "name": "Schema City Relationships View",
      "element": "/App_Plugins/SchemaCity/document-type-view.js",
      "weight": 50,
      "meta": { "label": "Relationships", "pathname": "relationships", "icon": "icon-map-alt" },
      "conditions": [{ "alias": "Umb.Condition.WorkspaceAlias", "match": "Umb.Workspace.DocumentType" }]
    }
  ]
}
```

The menu item and the workspace are joined by `meta.entityType`. `umb-menu-item-default` builds its
href as `section/{section pathname}/workspace/{entityType}`, so the entry links to
`/umbraco/section/settings/workspace/schema-city`, and `umb-workspace` then renders the one
`workspace` extension whose `meta.entityType` matches. This is how Log Viewer, Relations,
Extension Insights and Webhooks all sit in the Advanced group. The workspace carries no `kind`,
so our element is the whole workspace area with no header and no view tabs; `kind: "default"`
would add a headline and a tab strip, and `kind: "routable"` would add child routes we have no
use for. The element sets `display: block; height: 100%` to fill that area. Weight 50 puts the
entry below Umbraco's own four rather than reordering them.

The workspace view wrapper `entry-document-type-view.tsx` consumes `UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT` from `@umbraco-cms/backoffice/document-type` and observes `unique` for the key. It fetches the graph and mounts the same React `App` with that type pre-selected and focused through an `initial` prop. The icon is `icon-map-alt`, the same one as the sidebar entry, and weight 50 puts the tab after Design, Structure, Settings and Templates.

### Hosting

The wrapper is a Lit element that renders one container div, creates the React root once, re-renders it with new props on update, and unmounts it on disconnect. One root, never re-created. An R3F canvas that a re-render unmounts loses its WebGL context and its camera. These facts come from a working React-in-Umbraco project, not from the docs. The custom element registration is guarded with `customElements.get`, because a second evaluation of the entry must not throw.

The wrapper imports `styles.css?inline` and puts it in Lit's `static styles` through `unsafeCSS`. That is one `CSSStyleSheet` per module, attached to each wrapper's shadow root through `adoptedStyleSheets`. The harness builds the same sheet by hand and attaches it to `document`.

### Styling

One CSS entry compiled by Tailwind v4. The UI is shadcn components on base-ui, copied in from the afterglow registry (https://afterglow.thebuilder.dk/, MIT): the theme plus button, dialog, popover, tooltip, command, badge, kbd, scroll-area, table, tabs, sheet and alert. Not the preset, and none of the terminal-costume pieces (terminal window, shell, boot log, LED, scanlines, grain, glitch).

The theme is edited in place. The token block selector is `:host, :root`. The `.dark` block and every `data-phosphor` preset are deleted, and so are the base layer's `html`, `body` and `:root` rules. `::selection`, the `*` border-color rule and focus-visible stay. `@source "../";` follows the Tailwind import, because Tailwind's automatic source detection is rooted at the Vite root and the harness root is `dev/`.

The portal container is a context in `portal.ts` holding a ref to an empty div that `App` renders last. The copied `dialog`, `popover` and `tooltip` primitives are patched to pass that div as `container`, because the registry's wrappers do not forward it. Without it base-ui escapes to `document.body` and loses the stylesheet. Every portalled primitive copied in from the registry later needs the same one-line patch. `CommandDialog` from the registry is the dialog shell only, so `App` supplies its own `<Command>` root.

The label layer is a DOM layer over the canvas, positioned by the scene, and it sits inside the scene's stacking context (`z-0`), so the panels drawn beside the canvas (`z-10`) still win. Every future overlay has to sit outside the scene's stacking context too.

The scene reads `--phosphor`, `--signal` and `--phosphor-dim` from computed style on a div inside the shadow root, so there is no separate palette file.

### Vite

Library mode, ES output, `rollupOptions.external: [/^@umbraco/]`. Two entries, `workspace` and `document-type-view`, sharing `vendor.js` and `app.js`. `api.ts` sits outside `src/app/` and is shared by both, so it becomes its own small `api.js` chunk. No Vite React plugin; esbuild compiles JSX with `jsx: "react-jsx"`. The Tailwind plugin builds the one CSS entry. React, R3F, drei, base-ui, Three.js and dagre are bundled.

Library mode does not define `process.env.NODE_ENV`, so `define: { "process.env.NODE_ENV": '"production"' }` is required. Without it React throws "process is not defined" in the browser. Flat chunk names need `preserveEntrySignatures: "allow-extension"`, or Rollup emits a facade entry. No `base` is needed. The built entry imports `./Scene.js` relatively and it served 200 on both majors. The scene is a separate chunk behind `React.lazy(() => import("./Scene"))`, so the workspace paints its chrome before Three.js arrives, and opening Settings never pays for either. The dev script is `vite dev dev -c vite.config.ts`, because Vite looks for the config in the root it is given. Pinned at the spike: react 19.2.8, @base-ui/react 1.7.0, tailwindcss 4.3.3, three 0.185.1, @react-three/fiber 9.7.0, @react-three/drei 10.7.8, cmdk 1.1.1. Umbraco loads the manifest's `element` URL with a cache-busting query, so a lazy chunk that imports shared code back from the entry without that query gets a second module instance; `manualChunks` keeps the entry down to the wrapper alone, sorts a package into `vendor` when anything outside the lazy scene subtree needs it eagerly (a reachability check on module info, not a package name list, because fiber and drei pull in a dozen unnamed transitive packages), sorts the rest of the app code into `app`, and has `Scene.js` import `./vendor.js` and `./app.js` directly instead of the entry. Gzipped, the six chunks measure `workspace.js` 1.0 kB, `document-type-view.js` 1.2 kB, `api.js` 0.4 kB, `app.js` 44 kB, `vendor.js` 170 kB and `Scene.js` 345 kB.

### API client

One hand-written function per endpoint in `src/api.ts`, `getGraph()` and `getUsage(refresh = false)`, each calling `umbHttpClient.get<{ 200: SchemaGraph }>({ security: [{ type: "http", scheme: "bearer" }], url })` and wrapped in `tryExecute` by the caller. The `security` entry is required; without it the backoffice client sends no token. The type parameter is the status map, not the payload, because the client unwraps `Record` types by value. No Swagger document and no generated client: Umbraco 18 replaced Swashbuckle's document generation with Microsoft.AspNetCore.OpenApi, the 17 extension types no longer exist, and a composer deriving from them stops the whole assembly loading at boot on 18.

### Dev harness

`Client/dev/index.html` renders the same React `App` with a fixture graph; there is no HTTP layer to fake. The harness root is `dev/`, which is why the Tailwind entry carries `@source "../";`. Fixtures: `small.json` (12 types), `medium.json` (80 types, folders, compositions, blocks), `pathological.json` (cycles, self-allowed folders, 40 element types, orphan types), `medium-usage.json` (the seeded site's usage report, exported next to the graph), `small-usage.json` (hand-written for the 12-node fixture). Exported from the seeded test site with a one-line script so fixtures stay honest. `medium.json` is rewritten by the seeded site on every Development boot, so it is always the endpoint's real shape.

---

## 6. Visual and layout specification

### Layout (`app/layout/city.ts`)

1. Partition nodes into districts:
   - **Structure district**: every non-element type reachable from an `allowedAsRoot` type along `allowedChild` edges, plus roots themselves.
   - **Detached district**: non-element types not reachable from any root (dead ends and pure compositions).
   - **Element district**: `isElement` types.
2. Run dagre (rank direction top-to-bottom, `ranker: "network-simplex"`) on the structure district using only `allowedChild` edges. Roots get rank 0. Cycles are fine, dagre reverses back edges. Read back the rank and the left-to-right order inside it, and nothing else. Dagre's own `x` is unusable on a real schema: an allowed-child graph is shallow and wide, and every edge that skips a rank threads a dummy node through the ranks between it, so the seeded 78-type fixture ranked into a district 624 units wide and 66 deep, which frames as a diagonal line of buildings a pixel or two tall.
3. Fold each rank into rows of at most 8 buildings, each row centred on the district's axis. The order within a rank follows the leftmost already-placed parent from any earlier rank, not only the rank above, which also handles edges that skip a rank. Dagre's order breaks ties. Rows inside one rank sit a footprint plus a gap apart, and the next rank starts after the last of them plus the rank gap. The same fixture then measures 40 by 87. Eight is the number of buildings that stay legible side by side once the camera frames the whole city, and it is the same limit the packed grids use.
4. Lay out the detached and element districts as packed grids, sorted by alias, with rows of at most 8. They sit south (element) and east (detached) of the structure district with a street between.
5. Optional folder districts: when the schema uses folders, the structure ranking still governs position, but the ground slab under each node is tinted by folder and a folder label is drawn at the centroid. Folders do not move buildings; a folder that spans the map is a fact about the schema, not a layout bug.
6. Positions are world units throughout: a building footprint is 2 units, two buildings in a row sit one footprint apart, and a rank gap is 6 units.
7. Output `Placement { node, position, footprint, height, floors, district, introDelay }`.

Determinism: sort nodes and edges by alias before dagre. Dagre is deterministic for a given input order, and two nodes that land on the same dagre `x` break the tie by alias, so the layout needs no persistence and no hash.

### Focus layout (`app/layout/focus.ts`)

`layoutFocus(graph, neighbourhood, focusId, cityPlacements)` places the focused node and its neighbours. It takes the graph as well, because the neighbourhood model has no list of the types that compose the focused one.

- focused node at the origin
- allowed parents in arc rings of at most 8 to the north. An unbounded arc swings into the corner groups
- allowed children in rows of 8 to the south
- compositions and the inherited parent on a raised platform to the north-west. `Placement` gained an optional `y` for it
- types that compose it to the north-east
- block targets to the south-west, block hosts to the south-east
- reference targets east, reference sources west

Only the focused node's edges draw: roads for `allowedChild`, raised azure lines for `composition` and `inherits`, dipped amber lines for `block`, dotted violet lines for `reference`. Everything that is not a neighbour fades.

Entry is a double-click, Enter on the selected node, or the inspector's Focus button. The camera flies in over 700 ms and any pointer down on the controls interrupts it. Each neighbour tweens from its city placement to its focus placement over 400 ms with smootherstep, and reduced motion skips the tweens. Double-click a neighbour, or pick one in the inspector or the palette, to refocus. The first Escape leaves focus and keeps the selection, the second clears it.

Ceiling: more than about 30 parents plus compositions at once pushes the outer arc into the north-west grid. Nothing in the seeded schema is close.

### Encoding

| Visual | Data |
| --- | --- |
| Building | Document Type |
| Floors (stacked boxes, 0.6 units each) | property groups, in editor order; tabs get a thin slab separator |
| Floor tint | own group: phosphor; composed group: desaturated phosphor with a diagonal hatch in the shader |
| Footprint | `2 + 0.25 * clamp(ownPropertyCount, 0, 12)` units square, so it never dominates |
| Roof cap colour | Umbraco icon colour suffix if present, else neutral |
| Roof icon | Umbraco icon rasterised to a sprite (M4) |
| Root plaza | flat disc under `allowedAsRoot` buildings with a small flag |
| Element Type form | low, wide, chamfered "warehouse" in amber, no roof cap, distinct material |
| Usage badge | Usage count on the label layer above the selected node, whatever the lens |
| Selection | signal pink outline and label |
| Road (`allowedChild`) | flat ribbon on the ground with animated chevrons in the direction of the edge |
| Bridge (`composition` / `inherits`) | elevated quadratic arc, apex one arch above the taller roof. `inherits` is drawn as two arcs a hair apart, because WebGL ignores a line width above 1 |
| Block link | thin solid line dipping to ground level toward the element district. Dashes are what tells a reference apart from it |
| Reference | dotted line, hidden unless the References layer is on |
| Folder | ground slab tint + label |

### Usage lens

Same placements, different colours. The picker has six modes: None, Content count, Published share, Cultures, Incoming references and Unused. Sequential ramps run amber to azure, never phosphor against signal, because green against pink is the worst pair for colour-vision deficiency. Published share diverges around 50 percent. Unused is a signal highlight on non-element types with zero instances. Element types render neutral (`phosphor-dim`) under every lens, and root plazas are not recoloured. A legend row under the toolbar shows the minimum, the colour bar and the maximum. The selected node carries a usage badge ("162 · 152 published") on the label layer whatever the lens, and the picker is disabled with a tooltip until usage loads. The inspector has a Usage section with total, published, drafts, trashed, roots, cultures and last edited. Dark only, by choice. The theme has no light mode.

### World stage

The camera frames the city at a span of its longer side. At a true isometric angle a city `width` by `depth` covers `(width + depth) / sqrt(6)` of the framed height, so that span shows all of it with about a quarter of the height left for the buildings standing up in it.

The ground has to read as a large seamless world the city sits in, not a patch it fills. The ground plane and the grid extend far beyond the city bounds, distance fog in the void colour fades the far ground into the sky, and the sky is flat void with a subtle gradient or none at all. At any zoom the controls allow, the camera never shows a grid edge. The approach is borrowed from fsn's scene, which sets background and fog to the same void colour and draws one large grid plane re-centred on the camera each frame with its lines faded out by distance. Scheduled for M4. In M1 the grid extends to twice the city bounds and no further.

---

## 7. Interaction specification

| Action | Effect |
| --- | --- |
| Hover | outline + tooltip (name, alias, counts), label |
| Click | select: unrelated nodes and edges fade to 20%, inspector opens |
| Double-click / Enter | focus mode: 700 ms camera flight, neighbourhood layout, only the focused node's edges drawn |
| Double-click a neighbour in focus mode | refocus on it, camera flight |
| Escape | leave focus mode and keep the selection. Escape again clears the selection |
| Drag | orbit at a fixed isometric polar angle in ortho mode, free orbit in Explore |
| Right-drag / two-finger | pan |
| Wheel | zoom (ortho zoom, not dolly) |
| `Cmd/Ctrl + K` | search palette, substring match on type name, alias and every property alias (own and composed), type hits ranked above property hits. Enter selects; in focus mode it refocuses |
| Toolbar | layer toggles `Structure · Compositions · Blocks · References`, lens picker `Usage`, `Explore` camera toggle, `Findings` drawer, and the command palette, which is cmdk through afterglow's `command` component |
| Lens | Picker with six modes; disabled until usage loads; `lens=<name>` in the URL |
| Findings drawer | Sheet from the toolbar with a count badge, kind chips with counts, matched / total, rows grouped by severity; a row selects its node and closes. |
| Inspector | header (name, alias, badges for Element, Root and Varies by culture, and "N properties (own · composed)"), then only the sections that have something in them: Compositions, Inherits, Allowed parents, Allowed children, Block hosts, Block targets grouped by property alias, References out grouped by property alias and references in, Templates with the default marked, then Floors as a collapsible tree of tabs and groups showing each property's editor, mandatory marker and "composed from X". A block target that resolves to no node reads "missing element type" in the signal colour. Every type name is a button that selects that type, and there is one "Open in editor" button for the selected type rather than one per name, because a hub lists 25 rows |
| Labels | candidates are the hovered and selected nodes, the selected node's neighbours when there are at most 8, and every placed neighbour in focus mode. The scene then culls in screen space whenever the camera or the layout moves. Each candidate's box is estimated from its name, and boxes are kept in priority order (selected, hovered, then the rest) unless they land on one already kept, the building is under 6 px, or 40 labels are already up. A hidden name is one hover or one inspector row away |
| URL | `?type=<alias>&focus=1&layers=structure,blocks&lens=<name>` so the workspace view and findings can deep link. Written with `history.replaceState` by the app itself, unless the host passes `initial` or `onStateChange` and mirrors the state into its own route, as the Document Type tab does |

Accessibility: the canvas is `aria-hidden`; the inspector and a hidden type list are the accessible surface, with arrow keys moving selection and the scene following. A "list view" toggle that hides the canvas entirely is cheap and worth shipping in v1.

---

## 8. What to borrow from fsn, precisely

fsn is pnpm + Turborepo, Vite, three.js 0.179, Biome lint-only, vitest. Its `packages/app` is 5k lines and its `scene.ts` is 1.8k lines of filesystem-specific code, so copy mechanisms, not files.

| Take | From | Notes |
| --- | --- | --- |
| Pure layout returning `Placement[]`, scene consumes it | `packages/app/src/layout.ts` header | Keep this separation exactly |
| Camera flight type, `smootherstep`, `easeInOutCubic`, interruptible establishing shot | `scene.ts` `CameraFlight` | reuse verbatim |
| Activation dimming (1 = lit, 0 = background) | `DirectoryArea.activation` | becomes the selection fade |
| Staggered intro rise | `introDelay`, `INTRO_STAGGER` | ripple outward from roots |
| Names rendered as text, never as HTML | `viewers/dom.ts` | React does this by default; never `dangerouslySetInnerHTML`, because names and aliases are untrusted |
| World stage: sky, fog, ground extent | `scene.ts` | Fog colour equals the background so the ground dissolves instead of ending; grid and ground scale with the district; borrowed at M4 |
| Conventions | `CLAUDE.md` | why-comments, colocated behaviour tests, no snapshot tests |

Labels are one DOM layer over the canvas positioned from projected anchors, with screen-space culling in `app/scene/labels.ts`; R3F handles instanced picking; base-ui handles light dismiss.

### From flat diagnostics dashboards

Existing table-based Umbraco diagnostics tools answer most of the same questions. Taken from them: the grouped count query, the block configuration switch including `SingleBlockConfiguration`, composed-property detection by id set difference, the visited sets for nested block recursion, property-alias search, edit links from every type name, and findings with stable ids and severities. Not taken: Data Type nodes, configuration drift heuristics, template diagnostics, a chart toggle, and a lock around the cache.

Leave behind: `FsNode`, categories, directory areas, the route/history model, all viewers, Tauri.

---

## 9. Milestones

Each milestone ends with something runnable. Sizes are relative, not dates.

### M0, Scaffold (small)

- `dotnet new umbraco-extension -n SchemaCity -ex`, solution, test site, xUnit project.
- `SchemaSeeder` creates ~80 Document Types with folders, compositions, inheritance, Block List / Grid / RTE blocks, MNTP filters, roots, a cycle, orphans and element types, plus a few hundred content items so usage counts are non-trivial. It plants a known set of findings, listed in one test in `SchemaCity.Tests`. Runs once in Development only. The seeder writes no property values, so the seeded site has no instance references and the incoming-references lens is flat there.
- Dev harness with a hand-written `small.json`.
- CI: `npm ci`, `npm run build`, `dotnet build`, `dotnet test`, then boot the site and check the manifest, the backoffice and a 401 from the graph endpoint, on Umbraco 17.6.2 and 18.1.1.
- Done 2026-09-03 on Umbraco 17.6.2, with 18.1.1 as the second CI target.
- Exit: the Schema City entry in the Settings sidebar shows "Schema City, 80 types" from the real endpoint.

### M1, The city (large)

- Spike first, done 2026-09-03: a Lit wrapper hosting a React root, the afterglow theme with tokens on `:host, :root`, a base-ui dialog, popover, tooltip and command palette pinned inside the shadow root, and a 12-box R3F canvas with hover and click, working in the harness and served on both majors. Measured 179 kB + 340 kB gzipped. Checked by hand in the backoffice after fixing a double-loaded entry chunk; all four surfaces and the canvas render correctly.
  - Exit for the spike: the four base-ui surfaces and the R3F canvas worked in the harness and inside the backoffice on both majors.
- `SchemaGraphBuilder` complete for identity, behaviour, groups, properties, compositions, inheritance, allowed children, templates. Unit tests against hand-built `ContentType` instances. Done 2026-09-03. 13 tests; the seeded fixture has 511 edges across all five kinds.
- `BlockEditorInspector` for Block List, Block Grid, RTE blocks, MNTP filter. Unit tests per editor. Done 2026-09-03.
- `app/layout/city.ts` with districts and dagre; tests for determinism, cycles, empty schema, 300-node performance. Done 2026-09-03, 15 tests, about 30 ms for 300 nodes.
- Scene in R3F: ground, buildings with floors and tints, roads with chevrons, ortho camera, drei orbit controls and zoom, hover, select, fade, a DOM label layer with screen-space culling, intro rise.
- Inspector with all schema sections. Search palette. Done 2026-09-03; 42 tests.
- Exit: usable on the seeded schema and `pathological.json`; 300 types at 60 fps on an M-series laptop.

### M2, Layers and focus (medium)

- Focus mode with camera flight and neighbourhood layout, refocus by double-click, inspector or palette, Escape to return. Done 2026-09-03 (pulled ahead of the layers because a hub selection is a road fan and a list without it).
- Screen-space label culling. Done 2026-09-03; 17 labels, none overlapping, on the Home focus view.
- Compositions, Blocks, References layers with their edge styles. Done 2026-09-03; one merged line geometry per layer, and the block layer draws at 0.3 opacity because 302 distinct block links into 15 element types is a wall at full strength.
- A second Lit wrapper on the Document Type editor mounts the same `App` with `focus` set from the workspace context, plus an "Open in Schema City" link. Done 2026-09-03; visual check in the backoffice pending a login.
- URL state and deep links. Done 2026-09-03; `app/url.ts`, 12 tests.
- Exit: "Where is this composition used?" and "What uses this Element Type?" are two clicks from the Document Type editor.

### M3, Usage (medium)

- `UsageCollector` and `usage` endpoint with caching. Tests for the aggregation. Done 2026-09-03; four queries, 17 backend tests, and a deterministic `medium-usage.json` exported by the seeder.
- Usage lens with six modes, a legend row and a usage badge on the selected node. Done 2026-09-03.
- `findings.ts` with tests. Findings drawer listing unused types, unused element types, structural dead ends, duplicate property aliases, broken block references, types with no properties, types with no template, pure mixins and the top complexity tier, each linking to its node. Done 2026-09-03; every planted alias reported; 122 vitest tests.
- Exit: the findings drawer reports exactly the planted set on the seeded site, on both Umbraco majors.

### M4, Polish and release (medium)

- Roof icons, property "windows" on floors, Explore perspective toggle, list view fallback.
- World stage from fsn: far ground and grid, distance fog into the void colour, sky treatment, no visible grid edge at any allowed zoom.
- Empty state (no Document Types), error state (endpoint 403/500), loading skeleton.
- Perf pass, only if the pathological fixture drops below 60 fps. The edge geometry is already merged, one draw call per layer, so what is left is the label budget.
- README with screenshots, NuGet packaging with the `[17.0.0, 19.0.0)` range, Umbraco Marketplace metadata.
- Exit: `SchemaCity 1.0.0` on NuGet.

### Later, explicitly not v1

- Content mode: instances of a type as a tree, entered from a building.
- Instance-level block usage (parsing property JSON), which needs a background job and its own cache.
- Pinning buildings and persisting layout overrides per user.
- Export the city as PNG/SVG for documentation.
- Extracting a shared spatial-explorer package with fsn, only if a third graph appears.

---

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Layered layout shifts a lot when one type is added, breaking spatial memory | Deterministic input order limits it. Pinning is the later fix. Say so in the README. |
| Hub types (40+ neighbours) make selection views unreadable | Label cap, focus mode with a neighbourhood layout, and only the focused node's edges drawn. |
| Dagre edge routing looks poor with many-to-many allowed children | Roads are drawn as straight ribbons between buildings, not along dagre's polyline, so routing quality matters less. Swap to ELK if it ever matters. |
| Measured at the spike: 179 kB gzipped for the workspace entry, 340 kB for the lazy scene chunk, mostly drei | Chunk splitting brings the eager load to 1.0 kB for the workspace entry, 1.2 kB for the document-type-view entry, 0.4 kB for `api.js`, 44 kB of app and 170 kB of vendor, and the 345 kB scene chunk loads only when the city renders. Revisit drei imports at M1 exit; importing controls from `three/addons` directly is the fallback if 345 kB proves to matter. |
| The manifest entry loaded twice by the backoffice's cache-busting query | Neither entry exports anything another chunk imports; shared code and vendors live in their own chunks; the element registrations are guarded. |
| base-ui portals and focus inside a shadow root | Portal container inside our root, patched into each copied primitive; proven in the harness at the spike, verified in the backoffice on 2026-09-03. |
| Dark-only theme inside a light backoffice | Deliberate for the full-area workspace. The Document Type editor view stays a small canvas panel with Umbraco's own caption. |
| Usage queries slow on large installs | Four small queries for the whole install, 60 s cache, `refresh` on demand. The city never waits for usage. |
| Backoffice API surface changes between 17, 18 and 19 | The break in 18 was on the backend (OpenAPI extension types), not the three frontend imports the plan expected. Keep the composer to service registrations only, keep the frontend's Umbraco imports in the two wrapper elements, and let the CI boot step on both majors be the detector. |
| Shadow DOM and WebGL canvas sizing | `ResizeObserver` on the host element, `devicePixelRatio` cap at 2. |
| Untrusted names and aliases in the inspector | Rendered as text by React, never through `dangerouslySetInnerHTML`; the wrapper never builds HTML from names either. |

---

## 11. Verification

| Layer | How |
| --- | --- |
| Graph builder, block inspector, usage aggregation | 17 xUnit tests on hand-built `ContentType` / `DataType` instances; one integration test on the seeded site per milestone |
| `model/`, `app/` | 122 vitest tests across 12 files on fixtures: determinism (same input twice), cycle handling, empty graph, 300-node timing under 200 ms with realistic back edges, findings rules |
| Scene | vitest with jsdom for layout to placements; scene behaviour checked in the harness by eye |
| End to end | CI boots the seeded site on both majors and checks the manifest, the backoffice and the graph endpoint's 401. Interactions are checked by hand in the harness and in the backoffice at each milestone exit; no browser automation until a regression justifies it |
| Performance | `pathological.json` in the dev harness, with the browser's own frame profiler |

---

## 12. First tasks

1. Run the template, commit the untouched scaffold, then replace the example with `Constants.cs` and the graph controller. Done.
2. Write `Models/` and `model/types.ts` together so the contract is fixed before any rendering. Done.
3. Write `SchemaSeeder` and export `medium.json` from it. Done.
4. Build `app/layout/city.ts` with tests and view the result as flat coloured squares in the dev harness before touching buildings. Done.
5. Then buildings, then roads, then the inspector. Done.
6. Focus mode with the camera flight. Done. Screen-space label culling. Done. The Document Type editor tab. Done. The edge layers and URL state. Done. M3: the usage endpoint, the usage lens and the findings drawer. Done. Then the M3 tidy-up (dead end absorbs unused composition, no-template noise, element types neutral under a lens), usage in the wrappers, and the backoffice check. Next.

## 13. Resolved questions

- Supported versions: Umbraco 17 LTS and 18+, one package, CI on both.
- Licence: MIT.
- Audience: Settings tool only, access controlled by Umbraco user group permissions for the Settings section.
- Test bed: the seeded schema, with planted findings, stands in for a real project.
