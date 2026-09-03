# Schema City

An Umbraco backoffice extension that draws the content model as a map you can walk around.
This is milestone M0: a Settings dashboard that lists the Document Types it gets from one
endpoint. The city itself comes later. `PLAN.md` has the whole plan.

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

`npm run generate-client` regenerates `src/api/` from the running site's Swagger document at
`/umbraco/swagger/schema-city/swagger.json`, so the site has to be running for that one.

## CI

`.github/workflows/ci.yml` runs on push and pull request. It builds the client with Node 24,
then builds and tests the solution twice, once against Umbraco 17.6.2 and once against 18.1.1.
The matrix compiles and runs the unit tests; it does not boot the site.

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
file on first boot, and puts the dashboard under Settings. The login is in
`src/SchemaCity.Site/README.md`.

## Licence

MIT.
