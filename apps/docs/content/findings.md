---
title: Review findings
description: See what the schema checks flag, export findings as CSV, and mark the deliberate ones as intentional.
seo:
  image: /og/findings.png
---

Findings runs configuration checks on the schema and lists what they find, such as unused types, duplicate aliases, missing block targets and empty types. Filter by category, select a result, and inspect it with its related types. The drawer's header says when the schema was read and when the usage was counted.

Results are grouped by kind in a fixed order, with definite breakages such as broken blocks and duplicate aliases first. Each group explains its kind once and says what to do next. Each row shows the type and what is particular to it, such as where an unused type is allowed.

Problems are open and notes are collapsed. Within a group the strongest cases come first, for example an unused type whose allowed parents have no content either.

## What the checks flag

Only a type an editor can create, at root or under another type, is reported as unused. A type nothing can create is a dead end, or a pure mixin when something composes it.

The no template note is left out on a type already reported as unused. It is also left out when more than half of the creatable types have no template, since that schema is headless by design.

- **Unreachable chain.** A type with allowed parents, none of which a root can reach.
- **Culture mismatch.** An invariant type with a property that varies by culture, or with a block editor that lists an Element Type that varies by culture.
- **Near-duplicate Data Type.** Data Types whose names match once case, spaces, hyphens and underscores are ignored. Each set is one note, on a type that uses the least-used of them. The note lists every other type that uses any of them.
- **Overloaded tab.** A tab with more than 20 properties, composed ones included. On a type without tabs, a group with more than 20.
- **Empty block.** An Element Type offered as a content block that has no properties. It is a note, because a divider or spacer block is often empty on purpose.
- **Orphaned blocks.** Content stores blocks of an Element Type that no block editor lists any more. This is a problem. It takes the place of the unused Element Type row once usage has loaded, and names the Data Types the blocks are stored in.
- **Unused Data Type.** A Data Type that no property on a Document, Media or Member Type uses, and no collection view either. It is a note about the Data Type itself and opens its page. The Data Types Umbraco installs itself are left out, since every site has a dozen it never uses.

Once usage has loaded, an unused Element Type row says how many blocks of it content stores. A broken block row says how many blocks of the missing Element Type content still holds. Rows that name a Data Type link to its page.

![Findings grouped by kind, broken blocks and duplicate aliases first, each row naming its own evidence.](../../../docs/screenshots/findings.png)

Treat a finding as a reason to investigate before you delete anything. An unused Document Type has no counted content in the usage snapshot. An unused Element Type has no configured block editor use in the schema snapshot and, once usage has loaded, no stored block counted either. A count that stopped early says so. Custom code, migrations, external consumers, and media or member values can still depend on either.

## Export findings as CSV

Export CSV saves the filtered results as one header row and one row per finding, ready for an Excel or Jira import. The columns are, in order:

- the kind
- the type, with its key, folder, content counts and backoffice path
- the detail, explanation and next step
- related types by name
- Unused branch root, which for an unused type names its topmost unused ancestor, so a branch of unused types can go in one ticket
- the filter used, and the schema and usage snapshot dates
- the Data Types the finding names, with names and keys in two columns
- the review status, reason, who decided, when, and whether it reopened

A finding about a Data Type alone leaves the type columns blank and gives the Data Type's backoffice path.

## Mark a finding as intentional

Mark a deliberate finding as intentional so it stops asking for attention. Examples are a spacer block with no properties, a mixin kept for one type, or a type an import still reads.

Mark as intentional is on each row, in the inspector's checks and on a Data Type's page. It asks for a reason of up to 500 characters and records it with your name and the date. The row then reads "Intentional:" with the reason, and Undo removes the decision.

Hide reviewed is on by default. It takes decided rows out of the drawer, so the list shrinks to what still needs attention. The header counts both, for example "67 findings, 12 reviewed, 55 open". A row you decide stays in view until the drawer closes.

A reviewed finding goes quiet in the rest of the app too:

- In the List, the Tree and the Data Types list, its dot becomes a hollow grey ring whose label starts "Reviewed:".
- The inspector's Overview tab and a Data Type's Findings heading count open findings only, and give the reviewed ones separately, for example "1 reviewed". The "!" marks open problems only.
- Reviewed checks stay listed, greyed out, after the open ones, so you can still read the reason or Undo it.
- The Unused lens and the Editor page's flagged property rows count open findings only.

A reopened finding counts as open again in all of these.

![A broken block marked as intentional with its reason and Undo, and the reason form open on a duplicate alias.](../../../docs/screenshots/review.png)

## When a decision reopens

A decision holds only for the schema as it was when it was made. When the type or Data Type the finding is about changes, the finding is open again. It shows the old decision and "Reopened: the type changed since this was decided."

Each decision stores a fingerprint of that type or Data Type. The fingerprint covers its record, its groups and properties, its templates, and every connection in or out of it, allowed children, compositions and block targets included. Renaming the type, or a Data Type it uses, reopens the finding too, since the check errs towards asking again. Saving checks the fingerprint on the server, so a decision is never recorded against a type that changed after the page loaded.

## Where decisions are stored

Decisions are app data, not schema.

- Each finding gets one row in Umbraco's key-value table (`umbracoKeyValue`), stored as JSON under `SchemaCity.Decision.<finding id>`. The package needs no migration, and nothing in the Document Types, Data Types or content changes.
- Undo empties the row rather than deleting it, because Umbraco's key-value service has no delete.
- Everyone who opens Schema City on that site shares the decisions. They do not travel with a schema snapshot or uSync.
- Recording and undoing need the same Settings section access as the rest of the extension.
