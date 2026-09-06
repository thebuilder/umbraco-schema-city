# Development

Use the .NET 10 SDK and Node.js 24. The client uses npm and commits `package-lock.json`.
Run commands from the repository root unless a different directory is shown.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/SchemaCity` | Razor Class Library and NuGet package |
| `src/SchemaCity/Client` | React, TypeScript and Three.js client |
| `src/SchemaCity/Client/dev` | Standalone app with schema and usage fixtures |
| `src/SchemaCity.Site` | Seeded Umbraco integration site |
| `tests/SchemaCity.Tests` | .NET tests |

## Work on the client

```bash
cd src/SchemaCity/Client
npm ci
npm run dev
```

Open http://localhost:5173. This serves the same React app used in the backoffice, with fixture
data and Vite source maps. It does not run Umbraco or write the backoffice assets.

To see client edits inside Umbraco, run this instead:

```bash
cd src/SchemaCity/Client
npm run watch
```

Vite writes to `src/SchemaCity/wwwroot/App_Plugins/SchemaCity/`. In another terminal, run:

```bash
dotnet run --project src/SchemaCity.Site
```

See the [demo site guide](../src/SchemaCity.Site/README.md) for the URL and login.
Reload the backoffice after the client rebuilds. The watch command type-checks at startup;
run `npm run check` again after edits when you need a fresh type check.

The .NET project builds the client automatically only when `workspace.js` is missing. Once that
file exists, a .NET rebuild alone can leave old JavaScript in place. Use `npm run watch` or
`npm run build` after client changes. `-p:SkipClientBuild=true` skips the automatic client build
when assets have already been produced.

## Run checks

```bash
cd src/SchemaCity/Client
npm run check
npm test
npm run lint
npm run fallow
npm run build
```

Ultracite runs Biome formatting and lint checks. `npm run format` applies fixes. Fallow checks
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

Both routes require a backoffice user with Settings access:

| Route | Response |
| --- | --- |
| `GET /umbraco/management/api/v1/schema-city/graph` | Document Types, properties and configured relationships |
| `GET /umbraco/management/api/v1/schema-city/usage` | Content counts, cultures and observed references |

Usage is cached for one minute. Append `?refresh=true` to bypass that cache. The client calls the
routes directly through `Client/src/api.ts`; there is no generated API client.

The standalone fixtures are under `Client/dev/fixtures/`. A Development boot of the demo site
exports `medium.json` and `medium-usage.json` from the seeded installation. Their timestamps are
fixed for reproducible diffs, so 1970 dates in demo screenshots are fixture data.

## Build a local package

Build the client first so existing output cannot make the package stale:

```bash
cd src/SchemaCity/Client
npm ci
npm run build
cd ../../..
dotnet pack src/SchemaCity/SchemaCity.csproj -c Release -o artifacts -p:SkipClientBuild=true
```

The package includes the compiled backoffice assets and the root README. Source maps are excluded;
use the standalone dev server for client debugging. This command creates a local package and does
not publish it.

## Continuous integration

[The CI workflow](../.github/workflows/ci.yml) runs on pushes and pull requests. It lints and builds
the client, then builds and tests the .NET solution against Umbraco 17.6.2 and 18.1.1. Pull requests
also run the Fallow gate against their base commit. Run the client tests locally: the workflow does
not currently invoke Vitest.

Each matrix job boots the demo site and checks the backoffice, static package manifest, and 401
responses from both API routes for anonymous callers. The 17.6.2 job also packs the extension and
checks that the package contains `workspace.js`, has no source maps, and is smaller than 1 MB.

## Refresh README screenshots

Run the standalone client with `medium.json` selected. Capture the settled UI after the opening
animation at a consistent viewport size. Omit the fixture selector from the image; it belongs to
the demo page, not the extension. Do not alter schema values for screenshots.

Save images under `docs/screenshots/` and update the README captions to describe what they show.
The current set covers the structure overview, Home in focus, filtered findings, Article with the
content-count lens, the list sorted by own property count, and Top down. The README uses absolute
image URLs so images also work when it is included in a NuGet package.
