# Schema City

Inspect your Umbraco content model as a virtual city. Find configuration problems, follow a
type's relationships, and open its editor with the relevant context in view. One building per
Document Type, property groups as floors, and circuits for the relationships between types.

Source and issues live at
[github.com/thebuilder/umbraco-schema-city](https://github.com/thebuilder/umbraco-schema-city).

## What it does

Start with **Findings** to investigate configuration checks, **Search** to find a type or
property alias, or **List** to work without a 3D canvas. Select a building to inspect its
properties and direct connections. Focus its neighbourhood when the whole city gets crowded.

The stage traces its wireframe before materialising solid districts and buildings, then briefly
draws the relationship circuits before settling into faint background traces. Hovering or selecting a
type brightens its direct links; focusing a type keeps the local paths readable. Reduced motion
skips the opening animation. Structure is the initial connection layer; add other relationships as
you investigate them.

- **Sidebar workspace.** Schema City sits in the Settings sidebar under Advanced, next to
  Relations and Log Viewer, and opens the whole city. Click a building for an inspector with the
  type's properties, compositions, allowed children and block targets. Its Open in editor button
  goes to that type's editor. `⌘K` searches every type and property alias.

  ![78 Document Types as buildings on four island districts, named Pages, Elements, Compositions and Unfiled, with the structure roads running between them.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/city.png)

- **Editor tab.** The Relationships tab on a Document Type editor opens the same map, focused on
  the type being edited.
- **Layers.** Four kinds of road: structure (allowed children), compositions and inheritance,
  block targets, and picker references. Structure alone is on by default; the rest are noise until
  you ask for them.
- **Focus mode.** Enter, or the inspector's button, rebuilds the layout around one type and its
  neighbours. Expand one step brings in the next connected types, preserving the positions already
  in focus. Click a connection for its meaning, or expand the inspector’s connection explanations.
  Escape leaves focus, Escape again clears the selection.

  ![The Home type focused, with its compositions, its one allowed parent and its allowed children named around it and the inspector open on the right.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

- **Findings.** A drawer listing what looks wrong: unused types, unused Element Types, dead ends,
  duplicate aliases, broken block configurations, types with no properties, types with no
  template, pure mixins, and types complex enough to be worth a second look. Each row selects the
  type it is about. Related links identify contributing types, and broken block configurations
  expose missing target keys. The selected type's inspector includes its checks. Export the
  filtered findings as CSV, with the schema and usage snapshot timestamps, for a ticket or review.

  ![The findings drawer over the city, listing 115 findings with a row of filter chips above them.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

- **Usage lens.** Recolours the city by content count, published share, cultures, incoming
  references, or unused. Usage is a second call and the city never waits for it, so the lens
  picker stays disabled until it lands.

  ![The Content count lens on, buildings coloured along an amber to azure bar from 0 to 162, with Article selected and its 162 items on the badge above it.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

- **Two cameras.** Iso is the fixed isometric angle; Top down is an orthographic board view. Both
  keep the same city coordinates, with pan and zoom available in either mode. Use the camera
  toggle or `E` to switch between them.

- **List view.** The same schema as a sortable table, with no canvas in it. Every column sorts, the
  filter is the same search the palette runs, and a row opens the inspector.

  ![The list view, every type in a table sorted by own property count with the largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

- **Schema comparison.** Export the current schema as a versioned JSON snapshot, then import a
  snapshot from another environment or revision. Compare added and removed types, property groups,
  properties, compositions, allowed targets, and relationship changes. Matched buildings use the
  baseline positions; new types appear on added boards alongside them. The comparison is schema
  configuration only; usage data and custom code are
  separate concerns.

Outside comparison mode, adding a type can move buildings. The layout is deterministic for a given set of types, so it only
moves what it must, but there is no pinning yet.

Findings are review prompts. An unused Document Type has no counted content in the usage snapshot;
an unused Element Type has no configured block-editor use in the schema snapshot. Neither means
it is safe to delete. Schema connections and observed content references are different datasets,
and neither includes every possible dependency in custom code or external systems.

[Product direction](docs/product-direction.md) records the review, the intended developer
workflows, and the next features: directional dependency paths, property investigation, and root
reachability checks.

## Install

```bash
dotnet add package SchemaCity
```

Restart the site. Nothing to configure. Both endpoints need a backoffice login.

One package covers Umbraco 17 and 18. The dependency range is `[17.0.0, 19.0.0)`, and the host
site's own Umbraco reference decides which version actually loads.

## Demo site

`src/SchemaCity.Site` is a throwaway Umbraco site that references the project, so the extension can
be run and clicked.

```bash
dotnet run --project src/SchemaCity.Site
```

It listens on https://localhost:44341 and http://localhost:61801, installs itself into a SQLite file
on first boot, and seeds 78 Document Types with planted findings. The login and the seed details are
in `src/SchemaCity.Site/README.md`.

## Development

`src/SchemaCity` is the Razor Class Library that becomes the NuGet package. `Client/` holds the
TypeScript, which Vite builds into `wwwroot/App_Plugins/SchemaCity/`. `tests/SchemaCity.Tests` is
xUnit.

```bash
dotnet build SchemaCity.sln
dotnet test SchemaCity.sln
```

The .NET build runs `npm ci` and `npm run build` in `Client/` when the Vite output is missing, so
`dotnet pack src/SchemaCity/SchemaCity.csproj -c Release` works from a clean checkout. Pass
`-p:SkipClientBuild=true` where npm has already run. The library build writes no source maps,
which keeps the package at 2.6 MB unpacked instead of 9.5 MB, so debug the client through
`npm run dev`, where the Vite dev server serves its own maps. The client builds on its own too:

```bash
cd src/SchemaCity/Client
npm ci
npm run build   # or npm run watch
npm test        # vitest
npm run lint    # ultracite
npm run fallow  # fallow
```

Two tools keep the client tidy. Ultracite is a preset over Biome that both formats and lints.
`npm run lint` reports, `npm run format` rewrites. `biome.jsonc` extends the core, React and vitest
presets and turns off the rules that fight this code base, each with its reason on the line above,
and it skips the generated fixtures and the shadcn registry copy-in under `components/ui`. Fallow
reads the module graph for dead code, duplication and cycles. `npm run fallow` audits what changed
against the base commit, and `.fallowrc.jsonc` names the entry points it cannot infer. Neither tool
touches `wwwroot`, which Vite writes.

`npm run dev` runs the fixture harness on port 5173. It renders the same React app with no Umbraco
in the page, against the JSON fixtures in `Client/dev/fixtures/`. Every Development boot of the demo
site rewrites `medium.json` and `medium-usage.json` from the seeded install, with `generatedAt`
pinned to the Unix epoch so a boot alone does not change the file.

There is no generated API client. Umbraco 18 replaced Swashbuckle with the built-in ASP.NET Core
OpenAPI stack, and the two extension APIs share nothing, so the package registers no OpenAPI
document. `Client/src/api.ts` calls the endpoints by hand instead.

`.github/workflows/ci.yml` runs on push and pull request. It lints and builds the client with
Node 24, and audits the changed client code on a pull request, then
builds and tests the solution twice, once against Umbraco 17.6.2 and once against 18.1.1. Each leg
boots the site and checks that the backoffice answers, that
`/App_Plugins/SchemaCity/umbraco-package.json` is served, and that the graph and usage endpoints
both refuse an anonymous caller with 401. Compiling is not enough on its own. Umbraco finds
composers and controllers by scanning types at boot, so a type that vanished between majors only
shows up when the site runs. The 17.6.2 leg also runs `dotnet pack` and checks that the nupkg
carries `staticwebassets/App_Plugins/SchemaCity/workspace.js`, ships no `.map` files, and is under
1 MB. The site's Umbraco version is the `UmbracoVersion` MSBuild property, default 17.6.2, so the
same switch works locally:

```bash
dotnet build SchemaCity.sln -c Release -p:UmbracoVersion=18.1.1
```

The library project ignores it and keeps the full range.

`PLAN.md` has the whole plan.

## Licence

MIT.
