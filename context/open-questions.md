# LiveStore — Open Questions

- **LS-DQ1 Command/intent design placement.** RFC 0002 (command replay) is an
  active proposal: commands as replayable captures of user intent, spanning
  event model, sync, and the store API. Unresolved: whether the design gets a
  dedicated design-stage node in `02-system/` or folds into
  `01-event-model/` + `03-sync/` on acceptance. Blocked on: dedicated
  follow-up design session (requested 2026-07-15).

- **LS-DQ2 Contrib-repo referencing mechanics.** How `livestore-contrib`
  realizations reference and refine this tree: stub node shape, ID
  allocation across repos, and link direction. Blocked on: writing the first
  contrib realization stub.

## Initial coverage

Branch nodes defined in [spec.md](./spec.md) but not yet populated:

- `01-product/`
- `02-system/` and all nine children
- `03-delivery/` (absorbs `context/repo-architecture/` and
  `context/devtools-artifact-release/`)
- `04-docs/`
- `05-contributing/`
- `06-sustainability/`

Current drift between the branch table and reality is tracked in
[.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md).
