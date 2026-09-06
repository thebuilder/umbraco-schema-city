# SchemaCity.Site

A throwaway Umbraco site that references the SchemaCity project. Use it to run the extension in a
real backoffice and inspect the seeded graph. It is not part of the package and never ships.

The project targets .NET 10. It defaults to Umbraco 17.6.2 and also builds against 18.1.1:

```bash
dotnet run --project src/SchemaCity.Site -p:UmbracoVersion=18.1.1
```

The default command uses 17.6.2. The repository CI runs both versions.

Run it from the repository root:

```bash
dotnet run --project src/SchemaCity.Site
```

It listens on https://localhost:44341 and http://localhost:61801. The launch profile sets the
environment to Development. On the first boot, unattended install creates a SQLite database at
`src/SchemaCity.Site/umbraco/Data/Umbraco.sqlite.db`. Stop the demo site before deleting
that database to reset it. This discards the demo site's schema and content.

## Demo credentials

These credentials are for this throwaway site only. They are in `appsettings.json` in plain text so
Umbraco can install unattended. Never reuse them anywhere.

- Email: admin@example.com
- Password: SchemaCity1234!

`Umbraco:CMS:Imaging:HMACSecretKey` in `appsettings.Development.json` is a fixed dev-only value, so
a Development boot stops generating one and rewriting `appsettings.json`. A first boot in another
environment still writes a generated key into `appsettings.json`; revert that file afterwards.

## Seed data

`Seed/SchemaSeeder.cs` runs only in Development, on the first boot of an install with no Document
Types. It creates 78 Document Types: 15 Element Types, 7 compositions, and 56 structure types.
They use 3 folders, 5 Data Types, 3 templates, 2 languages, and 193 content items. It also plants the findings
listed in `SchemaSeeder.PlantedFindings`. Reset the demo database to seed again.

Every Development boot writes `medium.json` and `medium-usage.json` to
`src/SchemaCity/Client/dev/fixtures/` for the dev harness. Their `generatedAt` values are pinned to
the Unix epoch, so a boot alone does not change the files. Their contents reflect the demo
installation, including any edits made in its backoffice.

## Client harness

The harness renders the same client against fixture JSON without starting Umbraco. Install its
dependencies and start Vite from the client directory:

```bash
cd src/SchemaCity/Client
npm ci
npm run dev
```

Open http://localhost:5173. The harness uses the checked-in small, medium and pathological fixtures.

## API routes

The backoffice calls these endpoints from the Settings section. Both require the user's normal
Umbraco Settings section permission:

- `GET /umbraco/management/api/v1/schema-city/graph`
- `GET /umbraco/management/api/v1/schema-city/usage`

The usage endpoint accepts `?refresh=true` to skip its one-minute cache. There is no generated API
client.
