# SchemaCity.Site

A throwaway Umbraco 17 site that references the SchemaCity project, so the extension can be run
and clicked. It is not part of the package and never ships.

Run it from the repository root:

```bash
dotnet run --project src/SchemaCity.Site
```

It listens on https://localhost:44341 and http://localhost:61801. The first boot installs itself
unattended into a SQLite file at `umbraco/Data/Umbraco.sqlite.db`. Delete that file to start over.

## Dev credentials

These are for this local site only. They are in `appsettings.Development.json` in plain text,
which is how Umbraco's unattended install works. Never reuse them anywhere.

- Email: admin@example.com
- Password: ScXlyQOiHBASNYe3V3!7
