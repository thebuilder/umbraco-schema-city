# Schema City

An Umbraco backoffice extension that draws the content model as a map you can walk around.
This is milestone M0: a Schema City entry in the Settings sidebar, under Advanced, that opens a
workspace listing the Document Types it gets from one endpoint. The city itself comes later.
`PLAN.md` has the whole plan.

Umbraco 17 and 18 are supported from one package, dependency range `[17.0.0, 19.0.0)`.

## Layout

- `src/SchemaCity` is the Razor Class Library that becomes the NuGet package. `Client/` holds
  the TypeScript, built by Vite into `wwwroot/App_Plugins/SchemaCity/`.
- `src/SchemaCity.Site` is a throwaway Umbraco site for running the extension. See its README
  for the dev login.
- `tests/SchemaCity.Tests` is xUnit.

## Build

```bash
dotnet build SchemaCity.sln
dotnet test SchemaCity.sln
```

The TypeScript builds separately:

```bash
cd src/SchemaCity/Client
npm ci
npm run build
```

`npm run dev` runs the fixture harness without Umbraco.

There is no generated API client. Umbraco 18 replaced Swashbuckle with the built-in ASP.NET
Core OpenAPI stack, and the two extension APIs share nothing, so the package registers no
OpenAPI document. `Client/src/api.ts` calls the endpoint by hand instead.

## CI

`.github/workflows/ci.yml` runs on push and pull request. It builds the client with Node 24,
then builds and tests the solution twice, once against Umbraco 17.6.2 and once against 18.1.1.
Each leg then boots the site and checks that the backoffice answers, that
`/App_Plugins/SchemaCity/umbraco-package.json` is served, and that the graph endpoint refuses
an anonymous caller with 401. Compiling is not enough on its own. Umbraco finds composers and
controllers by scanning types at boot, so a type that vanished between majors only shows up
when the site runs.

The site's Umbraco version is the `UmbracoVersion` MSBuild property, default 17.6.2, so the
same switch works locally:

```bash
dotnet build SchemaCity.sln -c Release -p:UmbracoVersion=18.1.1
```

The library project is not affected by it. It keeps the `[17.0.0, 19.0.0)` range, and NuGet
resolves the floor for its own build.

## Run the site

```bash
dotnet run --project src/SchemaCity.Site
```

It listens on https://localhost:44341 and http://localhost:61801, installs itself into a SQLite
file on first boot, and puts Schema City in the Settings sidebar under Advanced, next to
Relations and Log Viewer. The login is in
`src/SchemaCity.Site/README.md`.

## Licence

MIT.
