# Schema City

An Umbraco backoffice extension that draws the content model as an isometric city you can walk
around. One building per Document Type, roads for the relationships between them.

Source and issues live at
[github.com/thebuilder/umbraco-schema-city](https://github.com/thebuilder/umbraco-schema-city).

## What it does

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
  neighbours and draws only its edges. Escape leaves focus, Escape again clears the selection.

  ![The Home type focused, with its compositions, its one allowed parent and its allowed children named around it and the inspector open on the right.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/focus.png)

- **Findings.** A drawer listing what looks wrong: unused types, unused Element Types, dead ends,
  duplicate aliases, broken block configurations, types with no properties, types with no
  template, pure mixins, and types complex enough to be worth a second look. Each row selects the
  type it is about.

  ![The findings drawer over the city, listing 115 findings with a row of filter chips above them.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/findings.png)

- **Usage lens.** Recolours the city by content count, published share, cultures, incoming
  references, or unused. Usage is a second call and the city never waits for it, so the lens
  picker stays disabled until it lands.

  ![The Content count lens on, buildings coloured along an amber to azure bar from 0 to 162, with Article selected and its 162 items on the badge above it.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/lens.png)

- **Two cameras.** Iso is the fixed isometric angle; Free stands a perspective camera on it and
  lets you orbit and fly. `E` switches between them.

  ![The city under the free camera, seen from a lower angle after a short orbit.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/free-camera.png)

- **List view.** The same schema as a sortable table, with no canvas in it. Every column sorts, the
  filter is the same search the palette runs, and a row opens the inspector.

  ![The list view, every type in a table sorted by own property count with the largest first.](https://raw.githubusercontent.com/thebuilder/umbraco-schema-city/main/docs/screenshots/list.png)

Adding a type can move buildings. The layout is deterministic for a given set of types, so it only
moves what it must, but there is no pinning yet.

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
```

`npm run dev` runs the fixture harness on port 5173. It renders the same React app with no Umbraco
in the page, against the JSON fixtures in `Client/dev/fixtures/`. Every Development boot of the demo
site rewrites `medium.json` and `medium-usage.json` from the seeded install, with `generatedAt`
pinned to the Unix epoch so a boot alone does not change the file.

There is no generated API client. Umbraco 18 replaced Swashbuckle with the built-in ASP.NET Core
OpenAPI stack, and the two extension APIs share nothing, so the package registers no OpenAPI
document. `Client/src/api.ts` calls the endpoints by hand instead.

`.github/workflows/ci.yml` runs on push and pull request. It builds the client with Node 24, then
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
