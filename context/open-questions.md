# LiveStore — Open Questions

- **LS-DQ1 Command/intent design placement.** RFC 0002 (command replay) is an
  active proposal: commands as replayable captures of user intent, spanning
  event model, sync, and the store API. Unresolved: whether the design gets a
  dedicated design-stage node in `02-system/` or folds into
  `01-event-model/` + `03-sync/` on acceptance. Blocked on: dedicated
  follow-up design session (requested 2026-07-15).

All branch nodes are populated as drafts (2026-07-15); node-local design
questions live in each node's spec. Remaining drift between the intent layer
and legacy doc surfaces is tracked in
[.delta/DELTA-001-legacy-intent-surfaces.md](./.delta/DELTA-001-legacy-intent-surfaces.md).
