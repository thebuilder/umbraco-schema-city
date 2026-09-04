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
- The client is linted and formatted by ultracite (Biome) and checked by fallow for dead code, duplicates and cycles; both run in CI. Client changes pass both before they merge (in progress).

---

## 1. Decisions

### Settled by the brief

- Isometric 2.5D map with an orthographic camera by default; free perspective is the opt-in Free camera.
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

8. **MIT licence, public repository from M1.** The repository is `github.com/thebuilder/umbraco-schema-city`, remote added 2026-09-04.

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
  umbraco-marketplace.json         marketplace metadata
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
      wwwroot/App_Plugins/SchemaCity/   Vite output, generated and gitignored; the BuildClient target fills it for dotnet pack
      Client/
        package.json  vite.config.ts  tsconfig.json  components.json
        public/umbraco-package.json
        src/
          api.ts                  endpoint calls, the editor link and icon resolution for the wrappers
          entry-workspace.tsx           Lit wrapper: fetches, mounts the React root, adopts the stylesheet
          entry-document-type-view.tsx  Lit wrapper for the Document Type editor, mounts App focused on the type
          model/                        graph types, indexes, findings, search   (no DOM, no three)
          app/                          React: App, layout, scene (R3F), panels, styles.css (Tailwind + afterglow theme)
          components/ui/                afterglow primitives, copy-in via the shadcn CLI
        dev/
          index.html  main.tsx      harness, loads fixtures without Umbraco
          fixtures/*.json            graph and usage fixtures; the medium ones are exported by the seeder
    SchemaCity.Site/                 throwaway Umbraco 17 site referencing SchemaCity
      Seed/SchemaSeeder.cs           dev-only: creates 78 Document Types on first boot
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
- There is one Lit wrapper per host that mounts that `App`, one for the home workspace and one for the Document Type editor view. The wrappers are the only Umbraco-aware code. They fetch, read the workspace context, resolve icons, and turn `onOpenType` into an editor link through `openTypeInEditor` in `api.ts`, which builds the route from Umbraco's `UMB_EDIT_DOCUMENT_TYPE_WORKSPACE_PATH_PATTERN` and pushes it onto the history. Icons resolve through the icon registry context's `icons` definitions and `loadManifestPlainJs`, not `getIcon`, which never settles for an unknown name.
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

Library mode does not define `process.env.NODE_ENV`, so `define: { "process.env.NODE_ENV": '"production"' }` is required. Without it React throws "process is not defined" in the browser. Flat chunk names need `preserveEntrySignatures: "allow-extension"`, or Rollup emits a facade entry. No `base` is needed. The built entry imports `./Scene.js` relatively and it served 200 on both majors. The scene is a separate chunk behind `React.lazy(() => import("./Scene"))`, so the workspace paints its chrome before Three.js arrives, and opening Settings never pays for either. The dev script is `vite dev dev -c vite.config.ts`, because Vite looks for the config in the root it is given. Pinned at the spike: react 19.2.8, @base-ui/react 1.7.0, tailwindcss 4.3.3, three 0.185.1, @react-three/fiber 9.7.0, @react-three/drei 10.7.8, cmdk 1.1.1. Umbraco loads the manifest's `element` URL with a cache-busting query, so a lazy chunk that imports shared code back from the entry without that query gets a second module instance; `manualChunks` keeps the entry down to the wrapper alone, sorts a package into `vendor` when anything outside the lazy scene subtree needs it eagerly (a reachability check on module info, not a package name list, because fiber and drei pull in a dozen unnamed transitive packages), sorts the rest of the app code into `app`, and has `Scene.js` import `./vendor.js` and `./app.js` directly instead of the entry. Gzipped, the six chunks measure `api.js` 0.7 kB, `workspace.js` 1.2 kB, `document-type-view.js` 1.4 kB, `app.js` 41 kB, `vendor.js` 210 kB and `Scene.js` 351 kB.

### Packaging

`dotnet pack src/SchemaCity/SchemaCity.csproj -c Release` from a clean clone produces `SchemaCity.1.0.0.nupkg`. It carries the built client as static web assets under `staticwebassets/App_Plugins/SchemaCity/`, which a host serves at `/App_Plugins/SchemaCity/` because `StaticWebAssetBasePath` is `/`, plus the README, the MIT licence, the author and the four Umbraco dependencies at `[17.0.0, 19.0.0)`. A `BuildClient` MSBuild target runs `npm ci` (only when `node_modules` is missing) and `npm run build`, with `BeforeTargets="ResolveProjectStaticWebAssets"`, and only when `wwwroot/App_Plugins/SchemaCity/workspace.js` is missing. The target then adds `wwwroot/**` back as `Content` itself, because the SDK globs `Content` at evaluation time, before Vite has written anything. `-p:SkipClientBuild=true` skips the target, and CI passes it after running its own npm build. The package measured 9.5 MB with 6.9 MB of `.js.map` in it, so the packaged build is being changed to ship no source maps. CI packs on the 17.6.2 leg and asserts the nupkg carries `workspace.js`, ships no `.map` files and is under 1 MB; it measured 599 KB at first, 629 KB after the M4 scene work and 642 KB after the focus pass.

### API client

`src/api.ts` is the wrappers' Umbraco helper module: one typed call per endpoint (`getGraph()`, `getUsage(refresh = false)`), the editor link (`openTypeInEditor`) and icon resolution (`resolveIcons`). The endpoint calls are hand-written, each calling `umbHttpClient.get<{ 200: SchemaGraph }>({ security: [{ type: "http", scheme: "bearer" }], url })` and wrapped in `tryExecute` by the caller. The `security` entry is required; without it the backoffice client sends no token. The type parameter is the status map, not the payload, because the client unwraps `Record` types by value. No Swagger document and no generated client: Umbraco 18 replaced Swashbuckle's document generation with Microsoft.AspNetCore.OpenApi, the 17 extension types no longer exist, and a composer deriving from them stops the whole assembly loading at boot on 18.

### Dev harness

`Client/dev/index.html` renders the same React `App` with a fixture graph; there is no HTTP layer to fake. The harness root is `dev/`, which is why the Tailwind entry carries `@source "../";`. Fixtures: `small.json` (hand-written, 12 types), `small-usage.json` (hand-written), `medium.json` (exported by the seeded site on every Development boot, 78 types) and `medium-usage.json` (exported the same way), plus `pathological.json` and `pathological-usage.json`. The two hand-written ones are not exported, and the two exported ones come out of the seeded test site with a one-line script, so they always have the endpoint's real shape. `pathological.json` and `pathological-usage.json` are the stress fixture: 300 types in 6 folders, 423 edges, a 60-child hub, a 12-parent child, cycles, rank-skipping edges, orphans and every planted finding kind, generated by `dev/make-pathological.mjs`.

---

## 6. Visual and layout specification

### Layout (`app/layout/city.ts`)

1. Districts follow the schema's folders. One district per top-level Document Type folder, named after it, plus **Unfiled** for types outside any folder. A nested folder stays inside its top-level district and records its id on each member's placement, which tints the slab under them. One structure district was a single pile. Folder blocks cut it into clusters, and the labels say what each block is.
2. With no folders, derive the districts by role and name them: **Pages** (reachable from a root along `allowedChild` edges, plus the roots), **Compositions** (composed by something, never placed), **Elements** (`isElement` types) and **Unplaced** (the rest). Pages is the fallback name only, because not every schema is pages. On the small fixture with its folder cleared that gives Pages 6, Compositions 1, Elements 3 and Unplaced 2, which comes out mixed; the fixture as shipped has one folder and renders Components plus Unfiled.
3. A district's kind is the role more than half its members share, one of structure, compositions, elements or mixed. The scene reads it for the building colours and the district label.
4. Inside a district, run dagre (rank direction top-to-bottom, `ranker: "network-simplex"`) over the members joined by `allowedChild` edges. Roots get rank 0. Cycles are fine, dagre reverses back edges. Read back the rank and the left-to-right order inside it, and nothing else. Dagre's own `x` is unusable on a real schema. An allowed-child graph is shallow and wide, and every edge that skips a rank threads a dummy node through the ranks between it, so the seeded 78-type fixture ranked into a district 624 units wide and 66 deep, which frames as a diagonal line of buildings a pixel or two tall. Each rank folds into rows of at most 8 buildings, each row centred on the district's axis. The order within a rank follows the leftmost already-placed parent from any earlier rank, not only the rank above, which also handles edges that skip a rank. Dagre's order breaks ties. Rows inside one rank sit a footprint plus a gap apart, and the next rank starts after the last of them plus the rank gap. Eight is the number of buildings that stay legible side by side once the camera frames the whole city, and it is the same limit the packed grids use. Members that no `allowedChild` edge joins pack into a grid one street below the ranked block, sorted by alias, at most 8 per row. A district with no structure is one grid. Consecutive ranks of at most two buildings stand side by side in one band, up to a row of eight, with a street between one rank's members and the next rank's. A band never merges past a back edge, one of the edges dagre reverses to rank a cycle. Only sparse ranks merge, because a full rank already reads as a generation, and merging fuller ranks widened districts that fold fine and put more roads on each street. On the stress fixture the Pages island went from 61 by 229, 8 percent of it filled, to 85 by 150, and the seeded schema's layout is unchanged apart from the stamp band.
5. Place the districts by kind. Structure districts, and mixed districts that contain structure, sit in the middle row, largest first. Compositions go north, so their bridges rise. Elements go south, so block links dip. Mixed districts with no structure sit east, and so do Unfiled and Unplaced whatever their kind. Streets are 9 units between ranks and between a district's ranked block and its grid; the void between islands is about 18 units (`DISTRICT_GAP`, twice a street).
6. Positions are world units throughout: a building footprint is 2 units, two buildings in a row sit one and a half footprints apart, and a street is 9 units. An island's padding is 3 units, except where the name's fallback band is reserved on islands whose plate has no empty spot.
7. `layoutCity(graph)` returns `Placement { id, position, footprint, height, floors, district, districtKind, folder?, introDelay }`; `cityDistricts(graph)` returns those placements plus a `District { id, name, kind, minX, maxX, minZ, maxZ, centre }` per district for the slabs and labels.

On the seeded schema this gives Compositions (7) north, Pages (42) in the middle, Elements (15) south and Unfiled (14) east.

Determinism: sort nodes and edges by alias before dagre. Dagre is deterministic for a given input order, and two nodes that land on the same dagre `x` break the tie by alias, so the layout needs no persistence and no hash.

### Focus layout (`app/layout/focus.ts`)

`layoutFocus(graph, neighbourhood, focusId, cityPlacements)` places the focused node and its neighbours. It takes the graph as well, because the neighbourhood model has no list of the types that compose the focused one.

- focused node at the origin
- the first band in any direction starts at half the focused node's footprint plus a street, 9 units. Later bands sit 3 units past the previous band's far edge
- rows inside a group pack each building at its own footprint, 3 units apart, and the rows sit 3 units apart
- allowed children in rows of 8 centred due south
- allowed parents in one row due north up to 8, and in arc rings past that, at a radius that keeps eight buildings over 120 degrees from touching
- corner groups stand beside the parent or child band when that widens the neighbourhood by at most one street, otherwise on the next band out, on their own side of the centre line. Compositions and the inherited parent go north-west on a raised platform (`Placement` gained an optional `y` for it), the types that compose it north-east, block targets south-west and block hosts south-east
- reference targets east and reference sources west, as columns of 8 at one street, placed last so they clear every band

`focusBounds(placements)` returns the neighbourhood's bounds with the island padding, and `focusAnchor` returns the focused node's city position. Home on the seeded schema, 42 neighbours, went from about 101 by 100 units to 49.5 by 58.5, or 56 by 65 padded; the worst hub on the stress fixture, 62 neighbours, is 67 by 78 padded. Fourteen of the 204 tests cover the focus layout: no two buildings share ground on any type of either fixture, everything sits within three streets on a small neighbourhood, the bounds cover every moved building, an isolated node yields its footprint plus padding, and the same graph lays out the same way twice.

Only the focused node's edges draw: roads for `allowedChild`, raised azure lines for `composition` and `inherits`, dipped amber lines for `block`, dotted violet lines for `reference`. Everything that is not a neighbour sinks to a flat plate 0.1 units high at about 0.12 opacity, with no label, no road and no picking, so the neighbourhood stands on a flat map that still shows where it is. Leaving focus restores the buildings with the same 400 ms tween. The focus layout is centred on the focused node's city position, so without this its rows landed on top of faded buildings and read as overlap.

Entry is a double-click, Enter on the selected node, or the inspector's Focus button. The camera flies in over 700 ms and any pointer down on the controls interrupts it. Each neighbour tweens from its city placement to its focus placement over 400 ms with smootherstep, and reduced motion skips the tweens. Double-click a neighbour, or pick one in the inspector or the palette, to refocus.

The scene stands the focus layout on `focusAnchor`, so the focused node holds still on its city ground and its neighbours gather around it. Before, the layout rendered unshifted around the world origin. A focus island grows out of the anchor over the same 400 ms as the buildings and shrinks back on leave. It has the district slab and rim look, in the focused node's district colour, sized by `focusBounds`. Its top is at 0.012, over the district slabs and names and under the roads at 0.015, so the sunk city plates still read through it. Raising it above 0.1 would bury the roads, and a `ponytail:` comment records that corner.

The app passes the inspector's width, 320 or 0 when it is closed, and the rig moves the framing target along the camera's own screen-right by half that width over the framing zoom. An orthographic camera's zoom is its pixels per world unit. The zoom itself is untouched, and Home's flight does the same. At the seeded city's framing this can push the west corner of the Elements island about 76 px off the canvas. Shrinking the framed span to the uncovered width is the follow-up if that matters.

The Leave focus button leaves focus and keeps the selection. The inspector's close button and a click on bare ground leave focus and clear the selection in one step. Escape takes the two steps one press at a time.

### Roads (`app/scene/roads.ts`)

1. Roads follow the streets. A road leaves its parent's face, drops to the street between the parent's row and the child's row, runs along that street to the child's column and enters the child's face, so every run is north-south or east-west. Straight ribbons between building centres crossed 282 times on the seeded schema; the same 64 roads routed this way cross 168 times. On the 300-type stress fixture it is 1246 against 390.
2. The rows and the streets are read off the placements rather than passed down from the layout. A row is a band of z that buildings occupy, and anything between two bands is ground nothing stands on. One rule covers the gap between two folded rows of a rank, the street between two ranks and the void between two islands, so a road between districts needs no second rule. A parent beside its child routes out of the parent's south face, along the street below the band, and back up into the child's south face.
3. A road that skips a rank runs along its parent's own street, then descends the child's column past every street in between. It joins the same trunk as the parent's other roads, which is what a route down the nearest column instead would lose.
4. Runs that lie on top of each other merge into one before geometry is built. Two children of one parent leave it by the same drop and fork at their own columns, and two parents of one child share the run into it, so a hub draws as one trunk that forks rather than as one ribbon per edge, and nothing z-fights. Two parents on one street take separate lanes 0.35 units apart, alternating around the mid-line and clamped to what the street holds. Lanes go by the order a parent reached the street, not by a channel router.
5. Chevrons ride the last 4.2 units before the child, pointing at it. A type that allows itself as a child keeps the small ring beside the building. Everything is still one merged `BufferGeometry`.
6. A building with more than three allowed parents draws only its nearest road in the overview, the one crossing fewest streets and the leftmost of those, and carries a "+N parents" marker on the label layer. The marker is the lowest priority label candidate, so it only takes pixels no name wants. Hovering or selecting the building draws its whole fan, and focus mode draws every road. Three is the point past which a fan reads as a knot rather than as a count; on the seeded schema one type crosses it, at five parents. A parent with many children is not cut, because the trunk absorbs it.
7. The block and reference layers route their ground segments the same way, so all four layers agree about where the ground is walkable. Composition arcs stay arcs.

### Encoding

| Visual | Data |
| --- | --- |
| Building | Document Type |
| Floors (stacked boxes, 0.6 units each) | property groups, in editor order; tabs get a thin slab separator |
| Floor tint | own group: phosphor; composed group: desaturated phosphor with a diagonal hatch in the shader |
| Footprint | `2 + 0.25 * clamp(ownPropertyCount, 0, 12)` units square, so it never dominates |
| Roof cap colour | `iconColor` from the contract if present, else neutral (the backend splits the colour suffix; the client never parses it) |
| Roof icon | Umbraco icon from the SVG the wrapper resolved, rasterised once per icon and colour into a cached canvas texture and drawn as one instanced quad mesh per icon-and-colour pair. It draws only when the building is about 24 px wide on screen or more (the gate dropped from 40 when the icons became flat textures); at the seeded schema's default framing nothing crosses the gate and icons appear about three times zoomed in. It fills about 70 percent of the roof in the node's icon colour, or phosphor when it has none, drawn flat on the roof over a darker cap rather than billboarded, so it never sits behind the label. Below that width nothing draws, except on the selected and hovered buildings, which always show theirs. The inspector header shows the icon too, as a CSS mask. The harness has no registry, so it draws none unless given a hand-made map |
| Root plaza | flat disc under `allowedAsRoot` buildings with a small flag |
| Element Type form | low, wide, chamfered "warehouse" in amber, no roof cap, distinct material |
| Property window | one small quad per property, walked around the walls of its group's floor: the floor's own colour turned up, and turned up further when the property is mandatory. Element Types have no floors, so they have no windows |
| Usage badge | Usage count on the label layer above the selected node, whatever the lens |
| Selection | signal pink outline and label |
| Road (`allowedChild`) | flat ribbon along the streets, with animated chevrons on the last stretch into the child. See Roads above |
| Bridge (`composition` / `inherits`) | elevated quadratic arc, apex one arch above the taller roof. An inherited parent arrives as both an `inherits` edge and a `composition` twin, and draws once, as the `inherits` arc: the composition azure mixed 40 percent toward white, drawn solid where the compositions around it draw at 0.85. The layer's strength rides in the vertex alpha, so one geometry holds both |
| Block link | thin solid line off the roof, down to the streets, along them to the target element type and up to its roof. Dashes are what tells a reference apart from it |
| Reference | the same street route, dashed and a little higher, hidden unless the References layer is on |
| District | One padded island per district: slab and rim, colour shifted by kind (compositions lighter, elements warmer), the name printed flat on the ground on the largest clear rectangle a one-unit scan of the plate finds (`scene/nameplate.ts`): no building footprint, no roof lean, no road or link run; edge strips before interior spots, right way up from the default azimuth, left-aligned inside that rectangle (cap 4 units, shrinking to 2.5 when no spot holds the full size; below that a north band the layout reserves takes it, about 7.9 units, which the smallest islands still need), one canvas texture per district, phosphor-dim, no depth write, under the roads like silkscreen under traces; it is a fixed element of the scene and does not turn with the camera; a name wider than its island shrinks to fit; a nested folder is a lighter rectangle under its members |

### Usage lens

Same placements, different colours. The picker has six modes: None, Content count, Published share, Cultures, Incoming references and Unused. Sequential ramps run amber to azure, never phosphor against signal, because green against pink is the worst pair for colour-vision deficiency. Published share diverges around 50 percent. Unused is a signal highlight on non-element types with zero instances. Element types render neutral (`phosphor-dim`) under every lens, and root plazas are not recoloured. A legend row overlays the top-left of the canvas with min, colour bar and max; it never sits in flow, because a row that resizes the canvas makes the camera re-fit and the scene jump. The selected node carries a usage badge ("162 · 152 published") on the label layer whatever the lens, and the picker is disabled with a tooltip until usage loads. The inspector has a Usage section with total, published, drafts, trashed, roots, cultures and last edited. Dark only, by choice. The theme has no light mode.

### World stage

The camera frames the city at a span of its longer side. At a true isometric angle a city `width` by `depth` covers `(width + depth) / sqrt(6)` of the framed height, so that span shows all of it with about a quarter of the height left for the buildings standing up in it.

Built 2026-09-03, after fsn's scene. Background and fog share the void colour. One grid plane of `span * 13.2` units follows the ground point at the centre of the screen every frame, from the camera's own centre ray, with its lines drawn from world position and faded radially from `span * 1.2` out to `span * 6`. Its squares are 6 and 30 world units, a ruler under the islands rather than their street plan. One padded slab with a rim carries each district, and the void with the grid shows between them. `cityBounds(placements, pad)` covers every island plus its padding, so the camera span and the grid fade follow it; the seeded city frames 141 by 146 with the island gap. The zoom clamp is derived from where the fade ends, so no edge can show at any zoom. Fog is not dormant under the orthographic camera, which was the guess here before Explore was built: three measures it in view depth, which varies across an orthographic frame as well, so it was already fading ground past `span * 1.8`. It is the Explore camera that makes it read, because the ground there recedes to a horizon. Either way, do not "fix" the distances by pulling them in. There is no star dome, because a dome has no parallax under an orthographic camera.

The free camera's field of view is 40 degrees; 45 stretched the city. It is aimed and its projection updated as it is placed, and placement waits for a measured viewport, so the first frame after the switch shows the framed city.

---

## 7. Interaction specification

| Action | Effect |
| --- | --- |
| Hover | outline + tooltip (name, alias, counts), label |
| Click | select a building: unrelated nodes and edges fade to 20%, inspector opens. Clicking bare ground clears the selection (done 2026-09-03) |
| Double-click / Enter | focus mode: 700 ms camera flight, neighbourhood layout, only the focused node's edges drawn, unrelated buildings sink to faint plates, the camera frames the neighbourhood in the uncovered part of the canvas |
| Double-click a neighbour in focus mode | refocus on it, camera flight |
| Escape | leave focus mode and keep the selection. Escape again clears the selection. Closing the inspector or clicking bare ground leaves focus and clears the selection in one step |
| Drag | Iso orbits around the centre at a fixed angle; Free orbits freely. Pan stays in the ground plane, which the grid relies on. Hover, selection and lens changes never move the camera; only focus mode's flight and the camera switch do |
| Right-drag / two-finger | pan |
| Wheel | zoom (ortho zoom, not dolly) |
| `Cmd/Ctrl + K` | search palette, substring match on type name, alias and every property alias (own and composed), type hits ranked above property hits. Enter selects; in focus mode it refocuses. The palette opens listing every type, fixed height, with a counter, swatches, alias, a property-count or matched-alias hint, an Escape hint and an Enter glyph, as fsn's does |
| `1` `2` `3` `4`, `L`, `E`, `Home`, `?` | Toggle the four layers in toolbar order; list view; switch the camera between Iso and Free; reframe the city with a 400 ms flight (leaves focus first); the control reference. Single keys are ignored while the palette or a dialog is open, while a text field has focus, or with a modifier other than Shift; the target is read off `composedPath` |
| `W` `A` `S` `D`, arrows, `R` `F`, `Shift` | Iso: W A S D and the arrows pan along the ground in screen directions at 900 CSS pixels a second whatever the zoom, and R and F do nothing. Free: W A S D fly along the heading at 24 units a second, the arrows turn with free yaw and a pitch that stops at the horizon and short of straight down, R and F rise and descend, and Shift doubles both. Keys ease over about 155 ms, move the camera and its orbit target together, cancel a framing flight as a pointer down does, and are ignored while a text field, contenteditable or dialog has focus; a held key drops on blur or on a modifier other than Shift. The control reference lists them in a FLIGHT group between MOUSE and KEYS, with Home moved into it. |
| Toolbar | Title, then a `Layers` button whose label carries the count (`Layers 2/4`) and opens a checkbox menu of Structure, Compositions, Blocks and References, the registry's base-ui menu with the portal patch; `1`-`4` still toggle the layers and the menu's checkboxes follow. Then a two-segment CAMERA control, ISO and FREE, and the `List` toggle. The right group is the lens picker, `Findings`, `Legend`, a `?` icon button for the control reference (aria-label "Control reference") and `Search` with its Kbd. Neither Search nor Help takes a tooltip, because a tooltip's exit animation played over the opening dialog. Triggers that open something (Layers, Findings, Legend, Help, Search, the lens picker) do not lift on hover; only action buttons do. The row wraps instead of clipping. It holds one line down to 848 px, and below that the right group folds under the title. The type-count badge is gone; the palette's counter and the list view carry the count |
| List filter | Registry input, type text, border highlight on focus with no ring, an own clear button; the palette's search input shares the same search function. The placeholder reads "Filter types" and the input keeps a minimum width |
| Lens | Picker with six modes; disabled until usage loads; `lens=<name>` in the URL. The legend overlays the canvas rather than resizing it |
| Findings drawer | Sheet from the toolbar with a count badge, kind chips with counts, matched / total, rows grouped by severity; a row selects its node and closes. |
| Control reference | a dialog opened by `?` or the Help button: an ESC chip, three groups (mouse, keys, objects), a Kbd column and one line of prose per row, in fsn's `man controls` shape |
| Inspector | header (name, alias, badges for Element, Root and Varies by culture, and "N properties (own · composed)"), then only the sections that have something in them: Compositions, Inherits, Allowed parents, Allowed children, Block hosts, Block targets grouped by property alias, References out grouped by property alias and references in, Templates with the default marked, then Floors as a collapsible tree of tabs and groups showing each property's editor, mandatory marker and "composed from X". A block target that resolves to no node reads "missing element type" in the signal colour. Every type name is a button that selects that type, and there is one "Open in editor" button for the selected type rather than one per name, because a hub lists 25 rows |
| Labels | candidates are the hovered and selected nodes, the selected node's neighbours when there are at most 8, and every placed neighbour in focus mode. The scene then culls in screen space whenever the camera or the layout moves. Each candidate's box is estimated from its name, and boxes are kept in priority order (selected, hovered, then the rest) unless they land on one already kept, the building is under 6 px, or 40 labels are already up. A hidden name is one hover or one inspector row away. District names are printed on their islands, so the DOM layer carries building names, the selected node's usage badge and the `+N parents` marker only. |
| URL | `?type=<alias>&focus=1&layers=structure,blocks&lens=<name>&view=list` so the workspace view and findings can deep link. Written with `history.replaceState` by the app itself, unless the host passes `initial` or `onStateChange` and mirrors the state into its own route, as the Document Type tab does |

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
| World stage: sky, fog, ground extent | `scene.ts` | Fog colour equals the background so the ground dissolves instead of ending; grid and ground scale with the district; borrowed 2026-09-03 |
| Control reference page | app shell | The `man controls` dialog: ESC chip, grouped Kbd rows, one line each; borrowed 2026-09-03 |
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
- `SchemaSeeder` creates 78 Document Types with folders, compositions, inheritance, Block List / Grid / RTE blocks, MNTP filters, roots, a cycle, orphans and element types, plus a few hundred content items so usage counts are non-trivial. It plants a known set of findings, listed in one test in `SchemaCity.Tests`. Runs once in Development only. The seeder writes no property values, so the seeded site has no instance references and the incoming-references lens is flat there.
- Dev harness with a hand-written `small.json`.
- CI: `npm ci`, `npm run build`, `dotnet build`, `dotnet test`, then boot the site and check the manifest, the backoffice and a 401 from the graph endpoint, on Umbraco 17.6.2 and 18.1.1.
- Done 2026-09-03 on Umbraco 17.6.2, with 18.1.1 as the second CI target.
- Exit: the Schema City entry in the Settings sidebar shows "Schema City, 78 types" from the real endpoint.

### M1, The city (large)

- Spike first, done 2026-09-03: a Lit wrapper hosting a React root, the afterglow theme with tokens on `:host, :root`, a base-ui dialog, popover, tooltip and command palette pinned inside the shadow root, and a 12-box R3F canvas with hover and click, working in the harness and served on both majors. Measured 179 kB + 340 kB gzipped. Checked by hand in the backoffice after fixing a double-loaded entry chunk; all four surfaces and the canvas render correctly.
  - Exit for the spike: the four base-ui surfaces and the R3F canvas worked in the harness and inside the backoffice on both majors.
- `SchemaGraphBuilder` complete for identity, behaviour, groups, properties, compositions, inheritance, allowed children, templates. Unit tests against hand-built `ContentType` instances. Done 2026-09-03. 13 tests; the seeded fixture has 511 edges across all five kinds.
- `BlockEditorInspector` for Block List, Block Grid, RTE blocks, MNTP filter. Unit tests per editor. Done 2026-09-03.
- `app/layout/city.ts` with districts and dagre; tests for determinism, cycles, empty schema, 300-node performance. Done 2026-09-03, 15 tests, about 30 ms for 300 nodes.
- Scene in R3F: ground, buildings with floors and tints, roads with chevrons, ortho camera, drei orbit controls and zoom, hover, select, fade, a DOM label layer with screen-space culling, intro rise.
- Inspector with all schema sections. Search palette. Done 2026-09-03; 42 tests.
- Exit: usable on the seeded schema (the pathological fixture followed in M4); 300 types at 60 fps (measured in the harness only: 165 fps on the seeded schema, an M-series Mac).

### M2, Layers and focus (medium)

- Focus mode with camera flight and neighbourhood layout, refocus by double-click, inspector or palette, Escape to return. Done 2026-09-03 (pulled ahead of the layers because a hub selection is a road fan and a list without it).
- Screen-space label culling. Done 2026-09-03; 17 labels, none overlapping, on the Home focus view.
- Compositions, Blocks, References layers with their edge styles. Done 2026-09-03; one merged line geometry per layer, and the block layer draws at 0.3 opacity because 302 distinct block links into 15 element types is a wall at full strength.
- A second Lit wrapper on the Document Type editor mounts the same `App` with `focus` set from the workspace context, plus an "Open in Schema City" link. Done 2026-09-03; checked in the backoffice the same day: opens focused on the edited type with the full toolbar and inspector.
- "Open in editor" link: found broken in the backoffice 2026-09-03 (the backoffice router cancels an in-flight navigation on any `replaceState`, and the app's URL writer fired exactly then); fixed the same day by writing URL state only while the location is still the route the app mounted under. Rechecked in the backoffice: Article's editor opens.
- URL state and deep links. Done 2026-09-03; `app/url.ts`, 12 tests.
- Exit: "Where is this composition used?" and "What uses this Element Type?" are two clicks from the Document Type editor.

### M3, Usage (medium)

- `UsageCollector` and `usage` endpoint with caching. Tests for the aggregation. Done 2026-09-03; four queries, 17 backend tests, and a deterministic `medium-usage.json` exported by the seeder.
- Usage lens with six modes, a legend row and a usage badge on the selected node. Done 2026-09-03.
- Both wrappers fetch the usage report after the graph without blocking the first render; a failed usage call leaves the lens disabled. Done 2026-09-03.
- `findings.ts` with tests. Findings drawer listing unused types, unused element types, structural dead ends, duplicate property aliases, broken block references, types with no properties, types with no template, pure mixins and the top complexity tier, each linking to its node. Done 2026-09-03; every planted alias reported; 122 vitest tests.
- Tidy-up done 2026-09-03: dead end absorbs unused composition, no-template notes only for placeable types on schemas that use templates, element types neutral under a lens; the seeded schema reports 115 findings with usage, every planted alias once.
- Exit: met 2026-09-03. The findings drawer reports every planted alias once on the seeded site, on both Umbraco majors, plus the 47 genuinely unused seeded types. Checked in the backoffice 2026-09-03: usage loads, the lens is enabled, the drawer shows 115.

### M4, Polish and release (medium)

- World stage from fsn: far ground and grid, distance fog into the void colour, sky treatment, no visible grid edge at any allowed zoom. Done 2026-09-03; the single city slab later became one island per district.
- NuGet packaging with the client build wired into `dotnet pack`, README for the package, marketplace metadata. Done 2026-09-03; screenshots done 2026-09-04 (six, from the harness, quantised).
- Roof icons on the roof caps. Done 2026-09-03; one instanced quad mesh per icon-and-colour pair from a cached canvas texture, 15 meshes on the seeded schema, drawn flat over a darker cap from about 40 px of footprint width and always on the selected and hovered buildings.
- Property "windows" on floors. Done 2026-09-03; one instanced quad per property walked around the floor's four walls, 616 on the seeded schema, each one its floor's colour turned up and brighter again when the property is mandatory.
- Explore perspective toggle. Done 2026-09-03; a perspective camera stood on the isometric camera's direction and target, free orbit above the horizon, the grid on the camera's centre ray, labels measured through a per-camera pixels-per-unit, `view=explore` in the URL, and turning it off restores the isometric framing.
- List view fallback. Done 2026-09-03; `TypeTable.tsx`, a real table with sortable headers and the palette's search as its filter, a row selects, and `view=list` in the URL. URL `view` is one of city, explore, list.
- Districts follow folders. Layout done 2026-09-03 (159 tests, 300 nodes in 37 ms); islands with rims, kind-shifted slab colours, nested-folder rectangles and district labels done the same day; spacing widened to one and a half footprints and 9-unit streets.
- Search palette in fsn's shape, fixed height. Done 2026-09-03; it opens on all 78 types, and the Search button carries the shortcut instead of a tooltip.
- Control reference and the key map (`1`-`4`, `L`, `E`, `Home`, `?`). Done 2026-09-03; `Help.tsx`, 17 rows in three groups, and 1.45 kB more app gzipped.
- Ground click clears the selection. Done 2026-09-03, with the Home reframe flight. `onPointerMissed` on the canvas clears it, and `Home` flies back to the city framing over 400 ms with smootherstep through a `reframe` prop on the scene, so nothing remounts and the buildings stay put.
- Lens picker on the registry select. Done 2026-09-03; afterglow's base-ui select, 0.9 kB more app and 14.5 kB more vendor gzipped.
- Camera reset on hover: cause was the framing effect re-running on viewport size changes. A resize, and some scrolls, re-ran it and re-applied the isometric framing, throwing away the orbit; hover only made it visible. Fixed 2026-09-03 with a pure `framingAction(last, next)` decision in `scene/stage.ts`, so only new bounds move the camera, plus one re-apply when the orbit controls arrive a render late. Orbit, hover, select and resize leave the camera untouched.
- Focus mode sinks the unrelated city to plates. Done 2026-09-03; 0.1 units tall on the same 400 ms tween as the move, and no picking while flat. The focus layout's own spacing needed nothing: no neighbourhood in the seeded schema overlaps, Home's 42 included.
- Empty state (no Document Types), error state (HTTP status), lens disabled with a reason when usage fails. Done 2026-09-03.
- Seeder log noise: application URL set, UI culture pinned to en-US in the demo site (the en-DK warnings were this Mac's locale). Done 2026-09-03; 585 warnings to 19.
- Roads follow the streets. Done 2026-09-03; crossings on the seeded schema fell from 292 to 94 at the time (282 against 168 once the stamp band shifted the districts; 1246 against 390 on the stress fixture), fan limit at 3 parents with a `+N parents` marker, chevrons on the last 4.2 units.
- District names stamped on the islands. Done 2026-09-03; 0.8 opacity because 0.55 vanished into the slab at overview zoom; the stamps do not fade with selection. Laid along the north edge they projected as a compressed diagonal. The camera-facing turn was tried and dropped, because a turned name's ground strip crossed the street behind and buildings covered letters.
- Keyboard flight, W A S D and arrows, isometric pan and Explore flight, FLIGHT group in the control reference. Done 2026-09-03; Home does not reframe under Explore yet.
- Stress fixture `pathological.json` (300 types). Done 2026-09-03; it laid out in about 80 ms at first (24 ms after the sparse rank bands) and exposed two layout defects, sparse ranks costing full bands and the unreserved stamp band, both fixed 2026-09-04 (sparse rank bands, a reserved stamp band).
- District stamp containment. Done 2026-09-04; fixed along the edge, placed once, band 4 units. The name is placed by a search for the largest empty rectangle on the plate, edges first, interior otherwise, with a reserved band only as a fallback, and every name on both fixtures sits on clear ground. The fixed-edge and fewest-crossings rules were dropped because names still sat under buildings and roads while the plate had empty ground.
- Wider gap between islands, about 18 units. Done 2026-09-04.
- No hover lift on menu and dialog triggers. Done 2026-09-04; the lift was a 1 px hover translate on the registry button, and Layers, Findings, Legend, Help and Search carry a `data-trigger` attribute that cancels it.
- Roof icon gate 24 px. Done 2026-09-04; nothing crosses it at the seeded default framing, icons appear zoomed in.
- Free camera fov 40 degrees, and the black first frame after the switch fixed. Done 2026-09-04.
- CAMERA control, ISO and FREE, replacing the Explore toggle. Done 2026-09-04; a two-segment toggle group, `E` flips it, `view=explore` stays the URL value, and the control reference says Iso and Free.
- List filter placeholder "Filter types", with a minimum width on the input. Done 2026-09-04.
- Focus mode: packed layout, focus island, inspector-aware framing, exit on deselect. Done 2026-09-04 (204 tests).
- Lens legend as an overlay, no canvas resize. Done 2026-09-04; the canvas frames are byte-identical with a lens on and off.
- Screenshots: `docs/screenshots/` six views from `dev/shots.mjs`, in the README and the marketplace entry; the marketplace URLs and the packed README's image paths point at `thebuilder/umbraco-schema-city` (filled in 2026-09-04).
- Shot polish: structure-only city shot, focus roads at full phosphor, the findings chip box (the toggle group painted its divider background behind a wrapped row). Done 2026-09-04.
- Inheritance drawn once, as a single brighter arc; the composition twin is skipped for that pair. Done 2026-09-04.
- Toolbar polish: filter input border highlight and own clear button, Layers menu (base-ui menu, 6.9 kB more vendor), Help icon, no type badge, wrapping toolbar below 848 px. Done 2026-09-03. The wrapped row spilling over the canvas was paint order (the absolutely positioned scene painted over the in-flow toolbar) plus a Toggle that could shrink under its label; fixed the same day with a stacking layer and `shrink-0`, measured from 1400 to 600 px.
- Perf pass, only if the seeded schema or a 300-node synthetic graph drops below 60 fps. The edge geometry is already merged, one draw call per layer, so what is left is the label budget.
- Exit: `SchemaCity 1.0.0` packed from main at 550d92e (643 KB) and pushed 2026-09-04; CI green on GitHub for both majors. Publishing to NuGet and the marketplace listing are the remaining steps, in Daniel's hands.

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
| Dagre edge routing looks poor with many-to-many allowed children | Roads follow the streets between ranks, not dagre's polylines, so its routing quality does not matter. Swap to ELK if it ever matters. |
| Measured at the spike: 179 kB gzipped for the workspace entry, 340 kB for the lazy scene chunk, mostly drei | Chunk splitting brings the eager load to 1.2 kB for the workspace entry, 1.4 kB for the document-type-view entry, 0.7 kB for `api.js`, 41 kB of app and 210 kB of vendor, and the 351 kB scene chunk loads only when the city renders. Revisit drei imports at M1 exit; importing controls from `three/addons` directly is the fallback if 351 kB proves to matter. |
| The manifest entry loaded twice by the backoffice's cache-busting query | Neither entry exports anything another chunk imports; shared code and vendors live in their own chunks; the element registrations are guarded. |
| The app's own URL writing fights the backoffice router | Write URL state only while the location is still the workspace route the app mounted under, and never after navigating away; use the backoffice's own navigation for the editor link. Done 2026-09-03. |
| Hover re-renders reset the camera | The framing effect moves the camera only for new bounds (`framingAction` in `scene/stage.ts`); verified by hand and by test. Done 2026-09-03. |
| The toolbar and the absolutely positioned canvas fight for paint order | The toolbar sits in its own layer, and the legend is positioned over the canvas in that layer, (`relative z-10`) with a background, `shrink-0`, and the canvas takes the remaining height with `min-h-0`; measured across widths rather than given a breakpoint. |
| Conditional rows above the canvas resize it and the camera re-fits | Anything conditional (the lens legend) overlays the canvas in the toolbar's layer; the canvas keeps its height. Done 2026-09-04. |
| Framing offset for the inspector pushes a city corner off the canvas | Accepted for now (about 76 px at the seeded framing); shrinking the framed span to the uncovered width is the follow-up. |
| base-ui portals and focus inside a shadow root | Portal container inside our root, patched into each copied primitive; proven in the harness at the spike, verified in the backoffice on 2026-09-03. |
| Dark-only theme inside a light backoffice | Deliberate for the full-area workspace. The Document Type editor view stays a small canvas panel with Umbraco's own caption. |
| Usage queries slow on large installs | Four small queries for the whole install, 60 s cache, `refresh` on demand. The city never waits for usage. |
| Backoffice API surface changes between 17, 18 and 19 | The break in 18 was on the backend (OpenAPI extension types), not the three frontend imports the plan expected. Keep the composer to service registrations only, keep the frontend's Umbraco imports in the two wrapper elements, and let the CI boot step on both majors be the detector. |
| Shadow DOM and WebGL canvas sizing | `ResizeObserver` on the host element, `devicePixelRatio` cap at 2. |
| Untrusted names and aliases in the inspector | Rendered as text by React, never through `dangerouslySetInnerHTML`; the wrapper never builds HTML from names either. |
| GitHub Actions v4 actions target the deprecated Node 20 runtime | Move checkout, setup-dotnet and setup-node to v5 (queued with the tooling branch). |

---

## 11. Verification

| Layer | How |
| --- | --- |
| Graph builder, block inspector, usage aggregation | 17 xUnit tests on hand-built `ContentType` / `DataType` instances; one integration test on the seeded site per milestone |
| `model/`, `app/` | 204 vitest tests across 17 files on fixtures: determinism (same input twice), cycle handling, empty graph, 300-node timing under 200 ms with realistic back edges, findings rules |
| Scene | vitest with jsdom for layout to placements; scene behaviour checked in the harness by eye |
| End to end | CI boots the seeded site on both majors and checks the manifest, the backoffice and the graph and usage endpoints' 401. Interactions are checked by hand in the harness and in the backoffice at each milestone exit; no browser automation until a regression justifies it. Last full run 2026-09-04 after the focus pass, green on both majors, nupkg 642 KB. On 18 the manifest is served before seeding ends, so the boot gate there proves less than on 17; the seeder line check covers it. CI also packs and checks the nupkg. First GitHub Actions run 2026-09-04: green on both majors |
| Performance | The seeded schema in the dev harness with the browser's own frame profiler; the stress fixture lays out in about 24 ms and a synthetic 300-node graph in 35 ms |

---

## 12. First tasks

1. Run the template, commit the untouched scaffold, then replace the example with `Constants.cs` and the graph controller. Done.
2. Write `Models/` and `model/types.ts` together so the contract is fixed before any rendering. Done.
3. Write `SchemaSeeder` and export `medium.json` from it. Done.
4. Build `app/layout/city.ts` with tests and view the result as flat coloured squares in the dev harness before touching buildings. Done.
5. Then buildings, then roads, then the inspector. Done.
6. M3 tidy-up, usage in the wrappers. Done. Backoffice check of the editor tab, drawer and lens. Done. Editor link fixed and rechecked. Then M4: packaging and states. Done. World stage. Done. Roof icons, windows, Explore camera, list view, palette, focus plates, camera fix, the controls page. Done. Districts as islands with labels. Done. Road routing along streets. Done. Toolbar polish. Done. Stamped district names. Done. Toolbar wrap fix. Done. Keyboard flight and the stamp orientation. Done. Sparse rank bands and the stamp band. Done. Stamp containment, the island gap, the icon gate, the free camera fov and its black first frame. Done. The camera switch, no hover lift on triggers and the list filter placeholder. Done 2026-09-04. The packed focus layout. Done. The focus island, inspector-aware framing, exit on deselect, the name search and the legend overlay. Done. Shot polish. Done. First push and the 1.0.0 pack. Done 2026-09-04. In progress: ultracite and fallow for the client, action versions to v5. Next: publish to NuGet, submit the marketplace listing.

## 13. Resolved questions

- Supported versions: Umbraco 17 LTS and 18+, one package, CI on both.
- Licence: MIT.
- Audience: Settings tool only, access controlled by Umbraco user group permissions for the Settings section.
- Test bed: the seeded schema, with planted findings, stands in for a real project.
