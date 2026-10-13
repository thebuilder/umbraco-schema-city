# Schema City

An Umbraco 17 and 18 backoffice extension that renders the content model as a Three.js city.
Setup, checks and releases are in [docs/development.md](docs/development.md), including the
architecture notes on why some code looks the way it does. Read those before changing the Lit
wrappers, the build config or anything portalled.

## Build rules

These apply to every commit, every file and every generated sentence.

- **Ponytail governs the code.** Climb the ladder before writing anything: does it need to exist,
  is it already in the repo, does the stdlib or the platform do it, does an installed dependency
  do it, can it be one line. No interface with one implementation, no config for a value that
  never changes, no scaffolding for later. A deliberate corner gets a `ponytail:` comment naming
  the ceiling and the upgrade path. Non-trivial logic leaves one runnable check behind.
- **Unslop governs the words.** Code comments, README, UI copy, error messages and commit
  messages. No em dashes, no "not just X but Y", no rule of three, no colons as connectors, no
  puffery, no filler. Say what the thing does, in plain words, with the number when there is one.
- Why-comments in full sentences, colocated behaviour tests, no snapshot tests, lowercase
  conventional commit prefixes.
- The client is linted and formatted by ultracite (Biome) and checked by fallow for dead code,
  duplicates and cycles; both run in CI, and client changes pass both before they merge. Registry
  copy-in under `components/ui` is exempt from both, because the shadcn CLI overwrites it.
