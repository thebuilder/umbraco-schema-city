---
title: Check content usage
description: Colour the city by content count, published share, cultures, incoming references or unused types.
seo:
  image: /og/content-usage.png
---

The Lens menu in the footer colours buildings by content count, published share, cultures, incoming references or unused status. Select a type to read its counts in the inspector.

The Unused lens marks the types that the unused checks in Findings flag. It marks a type as in use when it has content, a type composes it or a block editor lists it.

Usage loads separately from the schema, so you can explore the model while that request is pending. Usage is a snapshot, cached on the server for one minute. It is not a live dependency check.

![The Content count lens with Article selected and its usage totals in the inspector.](../../../docs/screenshots/lens.png)

Configured picker connections and observed references between content items are different data. The inspector's Connections tab reports them separately, under Picker references and Observed in content.
