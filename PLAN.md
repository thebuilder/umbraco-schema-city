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

4. **Findings (unused types, dead ends, unused compositions, complexity score) are computed client-side** in pure TypeScript from `graph` + `usage`. They are cheap, easy to test with fixtures, and it keeps the backend to data collection.

5. **Deterministic input order.** Nodes and edges are sorted by alias before layout, so the same schema always produces the same city. This is the FSN "spatial memory" property.

6. **A standalone dev harness** (`Client/dev/`) renders the scene from fixture JSON without Umbraco running. Most scene and layout work happens there; Umbraco is for integration.

7. **Support Umbraco 17 LTS and 18+.** NuGet dependency `Umbraco.Cms.Web.BackOffice` in the range `[17.0.0, 19.0.0)`, one code base, CI builds and runs the seeded site on both majors from M0. The three Umbraco-specific frontend imports live in one file so a breaking change in 18 or 19 is a one-file fix.

8. **MIT licence, public repository from M1.**

9. **Settings tool only, gated by Umbraco's own permissions.** The menu item is conditioned on the Settings section and both endpoints require `SectionAccessSettings`, so administrators control access per user group through the normal Users area. No custom permission or editor-facing view in v1.

10. **The seeded schema is the test bed.** No real project is required. The seeder plants known findings (orphans, unused compositions, dead ends, an unused element type) so tests and milestone exits assert against a deterministic expected set.

11. **React inside the Lit wrapper, with R3F and afterglow.** React 19 renders inside the Lit workspace element, the scene runs on React Three Fiber and drei, and the panels are shadcn components on base-ui from the afterglow registry, with Tailwind v4. The reason is the ecosystem around the scene. Event traffic was not the deciding factor, since a store handles that identically in Lit or React. R3F and drei give declarative meshes, instanced picking, camera controls and HTML labels, and shadcn gives the panel chrome, so there is less code we own. No state library until one is needed.

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
          api.ts                  one typed call per endpoint through umbHttpClient
          entry-workspace.ts      Lit wrapper: fetches, mounts the React root, adopts the stylesheet
          document-type-view.ts   Lit wrapper for the Document Type editor (M2)
          model/                  graph types, indexes, findings, search   (no DOM, no three)
          app/                    React: App, layout, scene (R3F), panels, styles.css (Tailwind + afterglow theme)
          components/ui/          afterglow primitives, copy-in via the shadcn CLI
        dev/
          index.html  main.ts        harness, loads fixtures without Umbraco
          fixtures/*.json
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
| Unused type | not element, `total === 0` |
| Unused element type | element, no incoming `block` edge |
| Unused composition | a type that exists only to be composed (no root, no incoming `allowedChild`, no instances) with zero incoming `composition` edges |
| Structural dead end | not `allowedAsRoot`, no incoming `allowedChild`, not element |
| Duplicate property alias | two compositions, or a composition and the type's own properties, contribute the same property alias. This is the composition bug that breaks editing |
| Broken block reference | a block editor configuration names an Element Type key that no longer exists. The block inspector emits this instead of silently dropping the edge |
| No properties | zero own and zero composed properties |
| No template | not element, zero allowed templates. Informational tier |
| Pure mixin | composed but never a child, never root, never a block (a pure mixin, informational) |
| Complexity | `own + composed properties + 2*compositions + block targets`, bucketed into 5 tiers for the lens |

Every finding carries a stable id (kind plus node id), a severity (problem or note) and the node it points at, so the drawer can filter and link.

---

## 4. Backend: what comes from where

All of this is in-process and runs on the host site. No new tables.

| Need | Source |
| --- | --- |
| All Document Types | `IContentTypeService.GetAll()` |
| Folders | `IContentTypeService.GetContainers(Array.Empty<int>())`, matched via `contentType.ParentId` / `Path` |
| Identity, icon, element, root, variations, description | `IContentType` properties; icon string split on space for the colour suffix |
| Own groups and properties | `PropertyGroups`, `NoGroupPropertyTypes` |
| Composed properties and their origin | `CompositionPropertyTypes` minus own `PropertyTypes` by id gives the composed set. For origin, walk `ContentTypeComposition` once and map each composition's own property ids to that composition |
| Inheritance | `ParentId` pointing at another content type rather than a container; emit `inherits` and keep the matching `composition` edge |
| Allowed children | `AllowedContentTypes` (`ContentTypeSort.Key`) |
| Templates | `AllowedTemplates`, `DefaultTemplate` |
| Block and picker targets | `IDataTypeService.GetAllAsync()`; inspect `EditorAlias` against `Constants.PropertyEditors.Aliases.BlockList`, `BlockGrid`, `RichText`, `MultiNodeTreePicker`; read `ConfigurationObject` (`BlockListConfiguration.Blocks[].ContentElementTypeKey` / `SettingsElementTypeKey`, `BlockGridConfiguration.Blocks[]`, `RichTextConfiguration.Blocks`, `SingleBlockConfiguration`, `MultiNodePickerConfiguration.Filter` as comma separated aliases). Nested block configuration can recurse, so the walk keeps a visited set of Data Type ids and one of content type keys. A configured Element Type key that resolves to nothing becomes a broken-block-reference finding |
| Content counts | One SQL query, left join from `cmsContentType` to `umbracoContent` and `umbracoNode` filtered to the document object type, grouped by content type, with `SUM` over `umbracoDocument.published` and `umbracoNode.trashed`. Left join so a type with zero content still gets a row. One round trip for the whole install |
| Root instances | nodes at level 1 grouped by content type (`IContentService.GetRootContent()` grouped, or the same query) |
| Cultures | `umbracoDocumentCultureVariation` grouped by content type, only when any type varies by culture |
| Instance references | `IRelationService` relations of type `Constants.Conventions.RelationTypes.RelatedDocumentAlias`, joined to both ends' content type and grouped |
| Last edited | max version date per type from `umbracoContentVersion` |

Caching and invalidation:

- The builder keeps the last `SchemaGraph` in a field and is registered as a singleton. Its two `INotificationHandler` registrations for `ContentTypeCacheRefresherNotification` and `DataTypeCacheRefresherNotification` are factory registrations that resolve that same singleton. Umbraco's `AddNotificationHandler` registers handlers as transient, which would clear a cache nobody reads. Those notifications fire on every server after any save, delete or move, so load balancing needs nothing extra.
- `UsageCollector` caches for 60 seconds. `?refresh=true` bypasses. No lock around the cold path; the query is one round trip.

Authorization: `[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]` on both controllers. The menu item is only registered under Settings, and the workspace view is inside the Settings section. Access is therefore whatever the administrator grants a user group for Settings; the package adds no permission of its own.

Resulting routes:

```
GET /umbraco/management/api/v1/schema-city/graph
GET /umbraco/management/api/v1/schema-city/usage?refresh=false
```

---

## 5. Frontend architecture

### Module rules

- `src/app/` is the React application and imports nothing from `@umbraco-cms/backoffice`. It takes the graph and usage objects and a `focus` id as props, and calls back through props (`onOpenType`).
- The two wrapper elements, the home workspace and the Document Type editor view, are the only Umbraco-aware code. They fetch, read the workspace context, resolve icons, and turn `onOpenType` into an editor link.
- The harness renders the same `App` from fixtures and a query string.
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
      "meta": { "label": "Relationships", "pathname": "relationships", "icon": "icon-map" },
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

The workspace view consumes `UMB_DOCUMENT_TYPE_WORKSPACE_CONTEXT` (from `@umbraco-cms/backoffice/document-type`) and observes `unique` to get the key. Verify the exact token name against the v17 package when scaffolding; the pattern is the same for every workspace.

### Hosting

The wrapper is a Lit element that renders one container div, creates the React root once, re-renders it with new props on update, and unmounts it on disconnect. It never re-roots. An R3F canvas that a re-render unmounts loses its WebGL context and its camera. These facts come from a working React-in-Umbraco project, not from the docs.

### Styling

One CSS entry compiled by Tailwind v4, imported `?inline`, attached to the shadow root through `adoptedStyleSheets` and to `document` in the harness. The afterglow theme's `:root` and `.dark` selectors are rewritten to `:host`, and its html and body base rules are dropped. The UI is shadcn components on base-ui, copied in from the afterglow registry (https://afterglow.thebuilder.dk/, MIT): the theme plus button, dialog, popover, tooltip, command, badge, kbd, scroll-area, table, tabs, sheet and alert. Not the preset, and none of the terminal-costume pieces (terminal window, shell, boot log, LED, scanlines, grain, glitch). The base-ui portals (dialog, popover, tooltip, command) are pinned to a container inside our shadow root, or they escape to `document.body` and lose the stylesheet.

### Vite

Library mode, ES output, one entry today (`workspace`; `document-type-view` arrives in M2), `rollupOptions.external: [/^@umbraco/]`. No Vite React plugin; esbuild compiles JSX with `jsx: "react-jsx"`. The Tailwind plugin builds the one CSS entry. Chunk URLs resolve relative to the loaded module, so no `base` is needed and chunk names stay flat. React, R3F, drei, base-ui, Three.js and dagre are bundled. The scene is a separate chunk behind a lazy import, so the workspace paints its chrome before Three.js arrives, and opening Settings never pays for either.

### API client

One hand-written function per endpoint in `src/api.ts`, calling `umbHttpClient.get<{ 200: SchemaGraph }>({ security: [{ type: "http", scheme: "bearer" }], url })` and wrapped in `tryExecute` by the caller. The `security` entry is required; without it the backoffice client sends no token. The type parameter is the status map, not the payload, because the client unwraps `Record` types by value. No Swagger document and no generated client: Umbraco 18 replaced Swashbuckle's document generation with Microsoft.AspNetCore.OpenApi, the 17 extension types no longer exist, and a composer deriving from them stops the whole assembly loading at boot on 18.

### Dev harness

`Client/dev/index.html` renders the same React `App` with a fixture graph; there is no HTTP layer to fake. Fixtures: `small.json` (12 types), `medium.json` (80 types, folders, compositions, blocks), `pathological.json` (cycles, self-allowed folders, 40 element types, orphan types). Exported from the seeded test site with a one-line script so fixtures stay honest. `medium.json` is rewritten by the seeded site on every Development boot, so it is always the endpoint's real shape.

---

## 6. Visual and layout specification

### Layout (`app/layout/city.ts`)

1. Partition nodes into districts:
   - **Structure district**: every non-element type reachable from an `allowedAsRoot` type along `allowedChild` edges, plus roots themselves.
   - **Detached district**: non-element types not reachable from any root (dead ends and pure compositions).
   - **Element district**: `isElement` types.
2. Run dagre (rank direction top-to-bottom, `ranker: "network-simplex"`) on the structure district using only `allowedChild` edges. Roots get rank 0. Cycles are fine, dagre reverses back edges.
3. Lay out the detached and element districts as packed grids, sorted by alias, with rows of at most 8. They sit south (element) and east (detached) of the structure district with a street between.
4. Optional folder districts: when the schema uses folders, the structure ranking still governs position, but the ground slab under each node is tinted by folder and a folder label is drawn at the centroid. Folders do not move buildings; a folder that spans the map is a fact about the schema, not a layout bug.
5. Map dagre `x, y` to three.js `x, z`, scaled so a building footprint is 2 units and a rank gap is 6 units.
6. Output `Placement { node, position, footprint, height, floors, district, introDelay }`.

Determinism: sort nodes and edges by alias before dagre. Dagre is deterministic for a given input order, so the layout needs no persistence and no hash.

### Focus layout (`app/layout/focus.ts`)

Given a focused node id, produce placements for the focused node and its neighbourhood:

- focused node at the origin
- allowed parents in an arc to the north, allowed children to the south
- compositions on a raised platform to the north-west, types that compose it to the north-east
- block targets (element types) to the south-west, block hosts to the south-east
- reference targets and sources on the flanks, faded

Everything else stays in the city at reduced opacity. The scene tweens each building from its city placement to its focus placement and back (400 ms, smootherstep from fsn).

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
| Usage badge | small numeric sprite above the roof when the Usage lens is on |
| Selection | signal pink outline and label |
| Road (`allowedChild`) | flat ribbon on the ground with animated chevrons in the direction of the edge |
| Bridge (`composition` / `inherits`) | elevated quadratic arc at roof height, thicker for `inherits` |
| Block link | thin dashed line dipping to ground level toward the element district |
| Reference | dotted line, hidden unless the References layer is on |
| Folder | ground slab tint + label |

### Usage lens

Same placements, different colours. Modes: content count (sequential ramp), published share (diverging around 50%), cultures, incoming references, unused/dead (binary highlight). Legend in the toolbar. Colours come from the afterglow theme tokens: phosphor green on void, pink signal, amber, azure and violet. Own groups are phosphor, composed groups desaturated phosphor, element types amber, selection signal. Any diverging or sequential ramp uses amber and azure, never phosphor against signal, because green against pink is the worst pair for colour-vision deficiency. Dark only, by choice. The theme has no light mode.

---

## 7. Interaction specification

| Action | Effect |
| --- | --- |
| Hover | outline + tooltip (name, alias, counts) |
| Click | select: unrelated nodes and edges fade to 20%, inspector opens |
| Double-click / Enter | focus mode: camera flight, neighbourhood layout |
| Double-click a neighbour in focus mode | refocus on it, camera flight |
| Escape / Backspace | leave focus mode, then clear selection |
| Drag | orbit at a fixed isometric polar angle in ortho mode, free orbit in Explore |
| Right-drag / two-finger | pan |
| Wheel | zoom (ortho zoom, not dolly) |
| `Cmd/Ctrl + K` or `/` | search palette, fuzzy on type name, alias and property alias, so "heroImage" finds every type that has that field. Enter selects and flies |
| Toolbar | layer toggles `Structure · Compositions · Blocks · References`, lens picker `Usage`, `Explore` camera toggle, `Findings` drawer, and the command palette, which is cmdk through afterglow's `command` component |
| Findings drawer | grouped by severity, filter by kind, each row links to its node. Counts shown as matched / total |
| Inspector | header (icon, name, alias, badges), Compositions, Allowed parents, Allowed children, Templates, Usage, then floors as a collapsible tree; every type name is a link that selects it. Every type name also has an edit link that opens the real Document Type editor |
| URL | `?type=<alias>&layer=<layer>&lens=<lens>` so the workspace view and findings can deep link |

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
| Conventions | `CLAUDE.md` | why-comments, colocated behaviour tests, no snapshot tests |

Three of fsn's mechanisms are not ported: drei's `Html` component replaces the sprite labels, R3F does instanced picking without the per-instance pick maps, and base-ui's dialog and popover cover light dismiss.

### From flat diagnostics dashboards

Existing table-based Umbraco diagnostics tools answer most of the same questions. Taken from them: the single grouped count query, the block configuration switch including `SingleBlockConfiguration`, composed-property detection by id set difference, the visited sets for nested block recursion, property-alias search, edit links from every type name, and findings with stable ids and severities. Not taken: Data Type nodes, configuration drift heuristics, template diagnostics, a chart toggle, and a lock around the cache.

Leave behind: `FsNode`, categories, directory areas, the route/history model, all viewers, Tauri.

---

## 9. Milestones

Each milestone ends with something runnable. Sizes are relative, not dates.

### M0, Scaffold (small)

- `dotnet new umbraco-extension -n SchemaCity -ex`, solution, test site, xUnit project.
- `SchemaSeeder` creates ~80 Document Types with folders, compositions, inheritance, Block List / Grid / RTE blocks, MNTP filters, roots, a cycle, orphans and element types, plus a few hundred content items so usage counts are non-trivial. It plants a known set of findings, listed in one test in `SchemaCity.Tests`. Runs once in Development only.
- Dev harness with a hand-written `small.json`.
- CI: `npm ci`, `npm run build`, `dotnet build`, `dotnet test`, then boot the site and check the manifest, the backoffice and a 401 from the graph endpoint, on Umbraco 17.6.2 and 18.1.1.
- Done 2026-09-03 on Umbraco 17.6.2, with 18.1.1 as the second CI target.
- Exit: the Schema City entry in the Settings sidebar shows "Schema City, 80 types" from the real endpoint.

### M1, The city (large)

- Spike first: a Lit wrapper hosting a React root, the afterglow theme adapted to `:host`, a base-ui dialog, popover, tooltip and command palette pinned inside the shadow root, and a 12-box R3F canvas with hover and click, running in the harness and in the backoffice on 17.6.2 and 18.1.1. If it fails, fall back to Lit before any city code exists.
  - Exit for the spike: the four base-ui surfaces and the R3F canvas work in the harness and inside the backoffice on both majors.
- `SchemaGraphBuilder` complete for identity, behaviour, groups, properties, compositions, inheritance, allowed children, templates. Unit tests against hand-built `ContentType` instances.
- `BlockEditorInspector` for Block List, Block Grid, RTE blocks, MNTP filter. Unit tests per editor.
- `app/layout/city.ts` with districts and dagre; tests for determinism, cycles, empty schema, 300-node performance.
- Scene in R3F: ground, buildings with floors and tints, roads with chevrons, ortho camera, drei orbit controls and zoom, hover, select, fade, drei `Html` labels, intro rise.
- Inspector with all schema sections. Search palette.
- Exit: usable on the seeded schema and `pathological.json`; 300 types at 60 fps on an M-series laptop.

### M2, Layers and focus (medium)

- Compositions, Blocks, References layers with their edge styles.
- Focus mode with camera flight and neighbourhood layout, refocus by double-click, Escape to return.
- Workspace view on the Document Type editor, pre-focused, plus an "Open in Schema City" link.
- URL state and deep links.
- Exit: "Where is this composition used?" and "What uses this Element Type?" are two clicks from the Document Type editor.

### M3, Usage (medium)

- `UsageCollector` and `usage` endpoint with caching. Tests for the aggregation.
- Usage lens with five modes and legend, badges on roofs.
- `findings.ts` with tests. Findings drawer listing unused types, unused element types, dead ends, unused compositions, duplicate property aliases, broken block references, types with no properties, types with no template, and complexity tiers, each linking to its node.
- Exit: the findings drawer reports exactly the planted set on the seeded site, on both Umbraco majors.

### M4, Polish and release (medium)

- Roof icons, property "windows" on floors, Explore perspective toggle, list view fallback.
- Empty state (no Document Types), error state (endpoint 403/500), loading skeleton.
- Perf pass, only if the pathological fixture drops below 60 fps: merged edge geometry per layer, label budget.
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
| Dagre edge routing looks poor with many-to-many allowed children | Roads are drawn as straight ribbons between buildings, not along dagre's polyline, so routing quality matters less. Swap to ELK if it ever matters. |
| React, R3F, drei and base-ui on top of Three.js, about 150 kB gzipped | Loaded only when the workspace opens; the scene chunk is lazy. Measure at the spike and again at M1 exit. |
| base-ui portals and focus inside a shadow root | Portal container inside our root, proven in the spike before any other UI is written. |
| Dark-only theme inside a light backoffice | Deliberate for the full-area workspace. The Document Type editor view stays a small canvas panel with Umbraco's own caption. |
| Usage queries slow on large installs | One grouped query for the whole install, 60 s cache, `refresh` on demand. The city never waits for usage. |
| Backoffice API surface changes between 17, 18 and 19 | The break in 18 was on the backend (OpenAPI extension types), not the three frontend imports the plan expected. Keep the composer to service registrations only, keep the frontend's Umbraco imports in the two wrapper elements, and let the CI boot step on both majors be the detector. |
| Shadow DOM and WebGL canvas sizing | `ResizeObserver` on the host element, `devicePixelRatio` cap at 2. |
| Untrusted names and aliases in the inspector | Rendered as text by React, never through `dangerouslySetInnerHTML`; the wrapper never builds HTML from names either. |

---

## 11. Verification

| Layer | How |
| --- | --- |
| Graph builder, block inspector, usage aggregation | xUnit with hand-built `ContentType` / `DataType` instances; one integration test on the seeded site per milestone |
| `model/`, `app/layout/` | vitest on fixtures: determinism (same input twice), cycle handling, empty graph, 300-node timing under 50 ms, findings rules |
| Scene | vitest with jsdom for layout to placements; scene behaviour checked in the harness by eye |
| End to end | CI boots the seeded site on both majors and checks the manifest, the backoffice and the graph endpoint's 401. Interactions are checked by hand in the harness and in the backoffice at each milestone exit; no browser automation until a regression justifies it |
| Performance | `pathological.json` in the dev harness, with the browser's own frame profiler |

---

## 12. First tasks

1. Run the template, commit the untouched scaffold, then replace the example with `Constants.cs` and the graph controller. Done.
2. Write `Models/` and `model/types.ts` together so the contract is fixed before any rendering. Done.
3. Write `SchemaSeeder` and export `medium.json` from it.
4. Build `app/layout/city.ts` with tests and view the result as flat coloured squares in the dev harness before touching buildings.
5. Then buildings, then roads, then the inspector.

## 13. Resolved questions

- Supported versions: Umbraco 17 LTS and 18+, one package, CI on both.
- Licence: MIT.
- Audience: Settings tool only, access controlled by Umbraco user group permissions for the Settings section.
- Test bed: the seeded schema, with planted findings, stands in for a real project.
