---
title: Quickstart
description: Install Schema City and open your content model as a city in the Umbraco backoffice.
seo:
  image: /og/quickstart.png
---

## Requirements

| Requirement | Version |
| --- | --- |
| Umbraco | 17 or 18, tested on 17.6.2 and 18.1.1 |
| .NET | 10 |
| Backoffice user | Access to the Settings section |

## Install

```sh
dotnet add package TheBuilder.SchemaCity
```

Restart the site. The package needs no migration and adds nothing to your schema.

## Open the city

Open **Settings > Advanced > Schema City**. The city opens on a raised view of the whole schema, with a board for each type allowed at root.

Every Document Type editor also gets a **Relationships** tab. It opens the city focused on that type and its neighbours.

## First steps

1. Press `⌘K` / `Ctrl+K` and search for a type by name, alias or property alias.
2. Click its building to open the inspector, then double-click it to focus on its neighbourhood.
3. Open **Findings** in the header to see what the checks flag across the schema. See [Review findings](/findings).
4. Press I with a type selected to see every type a change to it reaches. See [Trace the impact of a change](/impact).
5. Press ? for every control, or read [Navigate the city](/navigation).

To look around before you install, [try the demo](https://schema-city-demo.thebuilder.dk). It runs in the browser with a sample schema and needs no Umbraco install.
