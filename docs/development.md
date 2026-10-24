# Development

Use the .NET 10 SDK and Node.js 24, with `corepack enable` once so the pnpm version in the root
`package.json` is on the path. Every JavaScript package, the client's and the docs site's, is in
one pnpm workspace with one `pnpm-lock.yaml` at the repository root. Run commands from the
repository root unless a different directory is shown.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/SchemaCity` | Razor Class Library and NuGet package |
| `src/SchemaCity/Client` | The client's tooling, scripts and build config |
| `src/SchemaCity/Client/core` | Model, layout and findings in plain TypeScript, and the fixtures |
| `src/SchemaCity/Client/ui` | The shared React panels, the fixture harness and the theme tokens |
| `src/SchemaCity/Client/backoffice` | The Lit elements Umbraco loads, the API calls and the manifest |
| `src/SchemaCity/Client/city` | The City variant: the three.js scene and the afterglow theme |
| `src/SchemaCity/Client/clean` | The clean variant: the React Flow board and the backoffice theme |
| `src/SchemaCity.Site` | Seeded Umbraco integration site |
| `tests/SchemaCity.Tests` | .NET tests |
| `apps/docs` | Docs site at schema-city.thebuilder.dk, built with Blume |

## How the client fits together

The backoffice element in `backoffice/` is the only code that knows Umbraco. It fetches the graph,
picks a variant, imports that variant's package, `@schema-city/clean` or `@schema-city/city`, and
hands it the graph and the callbacks through `mount()`. Each variant passes the shared `App` from `ui/` its own
canvas, words and header tools, and its own stylesheet. The panels are written against colour
roles such as `bg-panel` and `text-phosphor`, which `city/src/styles.css` sets to the afterglow
palette and `clean/src/styles.css` sets from Umbraco's `--uui-*` tokens.

The whole client is one Vite build: the two entries Umbraco loads, which hold only the element,
and the two variants the element imports when asked for. React and the panels are one chunk both
variants load. three.js is reached only through the City's lazy `Scene` and React Flow only
through the clean variant's lazy `Board`, so the clean variant never downloads three.js.

`SchemaCity:Variant` in appsettings picks the variant every user opens on: `Clean` by default, or
`City`. Any other value opens on the city plan rather than failing. There is no per-user switch.

## Work on the client

```bash
pnpm install
cd src/SchemaCity/Client
pnpm dev
```

Open http://localhost:5173. This serves the clean variant with fixture data and Vite source maps,
against Umbraco's light theme tokens; add `?theme=dark` for the dark ones. `pnpm dev:city` serves
the City the same way. Neither runs Umbraco or writes the backoffice assets.

To see client edits inside Umbraco, run this instead:

```bash
cd src/SchemaCity/Client
pnpm watch
```

Vite writes the whole client to `src/SchemaCity/wwwroot/App_Plugins/SchemaCity/`. In another
terminal, run:

```bash
dotnet run --project src/SchemaCity.Site
```

See the [demo site guide](../src/SchemaCity.Site/README.md) for the URL and login.
Reload the backoffice after the client rebuilds. Umbraco requests the two entries with the package
version as their cache-busting query, which does not change between local builds, so the browser
can keep an old entry; reload with the cache disabled. Every other file carries a content hash.
The watch build does not type-check; run `pnpm check` when you need one.

The .NET project builds the client automatically only when `workspace.js` is missing, and installs
the workspace first when `Client/clean/node_modules` is missing. Once that
file exists, a .NET rebuild alone can leave old JavaScript in place. Use `pnpm watch` or
`pnpm build` after client changes. `-p:SkipClientBuild=true` skips the automatic client build
when assets have already been produced.

## Build and deploy the standalone demo

The Umbraco build produces extension modules, not a website. Use the separate demo build for
static hosting:

```bash
cd src/SchemaCity/Client
pnpm build:demo
pnpm preview:demo
```

This writes the city plan to `Client/dist` and the City to `Client/dist/city`, each with the same
fixtures the dev server uses, so the demo opens on the city plan and the City is at `/city/`. The
docs link both.
Only the dev server shows the harness's data switch (Demo, Worst case, Empty, One, 300 types).
It does not need an Umbraco server, API credentials, or a database. Editor links still log to the
console because the demo has no backoffice.

For Vercel, set the project Root Directory to `src/SchemaCity/Client`, use Node.js 24, and keep
**Include files outside the root directory** on, since the lockfile and the workspace are at the
repository root. The checked-in `vercel.json` selects `pnpm install --frozen-lockfile`,
`pnpm build:demo`, and output directory `dist`. Leave the ordinary `pnpm build` for the Umbraco
extension. Changing only Vercel's output
directory to `wwwroot` would deploy JavaScript modules without an HTML page.

## Work on the docs site

The docs site in `apps/docs` is built with [Blume](https://blume.dev) and the shared
`@thebuilder/umbraco-docs` package, so it looks like the other TheBuilder package sites. Its pages
are in `apps/docs/content`, and the landing page is `apps/docs/pages/index.astro`.

```bash
pnpm install
pnpm docs:dev
pnpm docs:build
```

The pages show the screenshots in `docs/screenshots/`, so a refreshed screenshot reaches the README,
the Marketplace listing and the docs at once.

For Vercel, set the project Root Directory to `apps/docs`, keep the default pnpm install, and
point the `schema-city.thebuilder.dk` domain at it.

## Run checks

```bash
cd src/SchemaCity/Client
pnpm check
pnpm test
pnpm lint
pnpm fallow
pnpm build
```

These cover every client package at once. Ultracite runs Biome formatting and lint checks.
`pnpm format` applies fixes. Fallow checks
the module graph, duplication and complexity; its gate reports newly introduced issues against
the Git base. Entry points are configured in `.fallowrc.jsonc`.

From the repository root:

```bash
dotnet build SchemaCity.sln
dotnet test SchemaCity.sln
```

The demo site defaults to Umbraco 17.6.2. To build it against the other CI version:

```bash
dotnet build SchemaCity.sln -c Release -p:UmbracoVersion=18.1.1
```

The package itself keeps its dependency range of `[17.0.0, 19.0.0)`. The consuming site chooses
the Umbraco version that runs.

## API and data

Every route requires a backoffice user with Settings access:

| Route | Response |
| --- | --- |
| `GET /umbraco/management/api/v1/schema-city/graph` | Document Types, properties and configured relationships |
| `GET /umbraco/management/api/v1/schema-city/settings` | The variant from appsettings, as `clean` or `city` |
| `GET /umbraco/management/api/v1/schema-city/usage` | Content counts, cultures and observed references |
| `GET /umbraco/management/api/v1/schema-city/decisions` | Recorded decisions on findings |
| `PUT`, `DELETE /umbraco/management/api/v1/schema-city/decisions/{findingId}` | Record or undo one decision, stored in `umbracoKeyValue` |

Usage is cached for one minute. Append `?refresh=true` to bypass that cache. The client calls the
routes directly through `Client/backoffice/src/api.ts`; there is no generated API client.

The standalone fixtures are under `Client/core/fixtures/`. A Development boot of the demo site
exports `medium.json` and `medium-usage.json` from the seeded installation. Every timestamp in
them is pinned to 2026-09-01 12:00 UTC for reproducible diffs, so that date in demo screenshots is
fixture data.

## Build a local package

Build the client first so existing output cannot make the package stale:

```bash
pnpm install --frozen-lockfile
cd src/SchemaCity/Client
pnpm build
cd ../../..
dotnet pack src/SchemaCity/SchemaCity.csproj -c Release -o artifacts -p:SkipClientBuild=true
```

The package includes the compiled backoffice assets and the root README. Source maps are excluded;
use the standalone dev server for client debugging. This command creates a local package and does
not publish it.

## Publish a release

Publish a GitHub release from `main` with a tag such as `v1.0.1`. The
[publish workflow](../.github/workflows/publish-nuget.yml) then:

1. reads the version from the tag, and refuses a tag that is not SemVer or a stable version on a
   GitHub prerelease,
2. runs the whole verify workflow at that version, which writes it into the manifest and the
   package and links the package's release notes to the release,
3. pushes the package that verify built to nuget.org.

The tag is the version, so nothing in the repository needs bumping first. The `<Version>` in the
csproj and the `version` in `Client/backoffice/public/umbraco-package.json` are only what local and CI
builds use, and CI fails if they differ.

The push uses NuGet trusted publishing, so no API key is stored. It needs, once:

- a trusted publishing policy on nuget.org for `thebuilder/umbraco-schema-city` with the
  workflow file `publish-nuget.yml`
- a GitHub environment named `nuget` with a secret `NUGET_USER`, holding the nuget.org profile
  name (not the email address)

The Umbraco Marketplace finds new packages through the `umbraco-marketplace` tag in a daily NuGet
scan at 04:00 UTC, then refreshes known packages every two hours. The listing takes its name,
icon, description and page text from the NuGet package, so the page text is the packed README.
`umbraco-marketplace.json` at the repository root adds the category, screenshots and links. An
`umbraco-marketplace-readme.md` beside it would replace the README on the listing; this repository
has none, so the two pages stay the same.
See [listing your package](https://docs.umbraco.com/umbraco-dxp/marketplace/listing-your-package).

## Continuous integration

[The CI workflow](../.github/workflows/ci.yml) runs on pushes and pull requests and calls
[verify](../.github/workflows/verify.yml), which the publish workflow runs too. It lints, tests and
builds the extension and standalone demo, then builds and tests the .NET solution against Umbraco
17.6.2 and 18.1.1. Pull requests also run the Fallow gate against their base commit.

Each matrix job boots the demo site and checks the backoffice, the static package manifest, and
401 responses from the API routes for anonymous callers. The 17.6.2 job also packs the extension.
It checks that the package contains `workspace.js`, both variants' canvases, the README and the
icon, has no source maps, is smaller than 1 MB, and has the same version in the nuspec and the
manifest. It uploads the package as the `TheBuilder.SchemaCity-package` artifact.

## Refresh README screenshots

`ui/dev/shots.mjs` captures them over CDP from a running harness; its header has the commands. The
city plan is the default, so every panel is shot on the plan with `pnpm dev`; run it again with
`VARIANT=city` against `pnpm dev:city` for the City's own three shots (`city.png`, `names.png` and
`free-camera.png`). The harness opens on the medium schema, and the script hides the sample picker
and the data switch, which belong to the demo page, not the extension. Do not alter schema values
for screenshots.

Save images under `docs/screenshots/` and update the README captions to describe what they show.
The README shows `plan.png`, `focus.png`, `findings.png`, `lens.png`, `impact.png`, `compare.png`
and `tree.png`. The docs site in `apps/docs` and `umbraco-marketplace.json` use most of the rest. The
README uses absolute image URLs so images also work when it is included in a NuGet package.
