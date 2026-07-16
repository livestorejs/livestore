# Docs — Requirements

Role: owns the documentation system — the derivation rule binding the docs
site to the intent layer, information architecture, snippet and diagram
policy, and the children: examples (`01-examples/`), search (`02-search/`),
and docs operations (`03-operations/`).

## Context

Builds on the root [requirements.md](../requirements.md) and
[decision 0002](../.decisions/0002-single-intent-layer.md). The docs site
lives in `docs/` (Astro Starlight) and publishes to `docs.livestore.dev`.

## Acceptable Tradeoffs

- **LS.DOCS-T01 Latest-only docs:** The site documents the latest release
  only; users of older releases may read docs that no longer match their
  version. Accepted to keep one always-current surface.

## Requirements

### Docs derive from the intent layer

- **LS.DOCS-R01 Derived surface:** The docs site teaches how to use the
  system; it never defines contracts. Any contradiction between docs and VRS
  is a docs bug. `refines: LS-R15`
- **LS.DOCS-R02 Canonical terms:** Docs use the terms defined in the root
  [ontology.md](../ontology.md); term drift is a docs bug.
  `refines: LS-R16`
- **LS.DOCS-R03 One site across repos:** Packages owned by
  `livestore-contrib` are documented on the same docs site.
  `refines: LS-R16, LS-A04`

### Docs content must stay verifiably correct

- **LS.DOCS-R04 Type-checked snippets:** Every code snippet in the docs is
  type-checked against the current packages; snippets that no longer compile
  fail CI as a required gate. Currently violated — the gate is optional
  since #1391 (see
  [.delta/DELTA-001-docs-gates-optional.md](./.delta/DELTA-001-docs-gates-optional.md)).
- **LS.DOCS-R05 Editable diagram sources:** Every architecture diagram in the
  docs has an editable source checked into the repo.

### Information architecture

- **LS.DOCS-R06 Audience paths:** The docs are organized along stable
  audience paths — orientation (overview), adoption (getting started,
  tutorial), building (building-with-livestore), depth (understanding),
  and per-realization sections mirroring the pluggable dimensions
  (platform-adapters, sync-providers, framework-integrations).
