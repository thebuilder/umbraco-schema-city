# SchemaCity.Site

A throwaway Umbraco 17 site that references the SchemaCity project, so the extension can be run
and clicked. It is not part of the package and never ships.

Run it from the repository root:

```bash
dotnet run --project src/SchemaCity.Site
```

It listens on https://localhost:44341 and http://localhost:61801. The first boot installs itself
unattended into a SQLite file at `umbraco/Data/Umbraco.sqlite.db`, in any environment, because the
unattended install settings and the connection string live in `appsettings.json` rather than the
Development overrides. Delete that file to start over.

## Demo credentials

These are for this throwaway site only. They are in `appsettings.json` in plain text, which is how
Umbraco's unattended install works. Never reuse them anywhere.

- Email: admin@example.com
- Password: SchemaCity1234!

`Umbraco:CMS:Imaging:HMACSecretKey` in `appsettings.Development.json` is a fixed dev-only value, so
a Development boot stops generating one and rewriting `appsettings.json`. A first boot in another
environment still writes a generated key into `appsettings.json`; revert that file afterwards.

## Seed data

`Seed/SchemaSeeder.cs` runs on the first Development boot of an install with no Document Types. It
creates 78 Document Types (15 Element Types, 7 compositions, 56 structure types) in 3 folders, 5
Data Types, 3 templates, 2 languages and 193 content items, and plants the findings listed in
`SchemaSeeder.PlantedFindings`. Delete `umbraco/Data/Umbraco.sqlite.db` to seed again.

Every Development boot writes the graph to `src/SchemaCity/Client/dev/fixtures/medium.json` for the
dev harness. The file's `generatedAt` is pinned to the Unix epoch so a boot alone does not change
it; the rest of the file only changes when the seed data does.
