# LiveStore — Open Questions

- **LS-DQ1 Command/intent design.** RFC 0002 (command replay) is an open
  proposal: commands as replayable captures of user intent that re-validate
  against current state on rebase, spanning event model, sync, and the store
  API. Its design and coined terms live in RFC 0002, not in the tree, per
  [.decisions/0004-rfc-vrs-boundary.md](./.decisions/0004-rfc-vrs-boundary.md)
  (this resolved the earlier placement question). Unresolved: whether to accept
  the design and fold it into the owning nodes. Blocked on: a dedicated
  acceptance decision backed by design/prototype evidence (per the evidence
  conventions in [spec.md](./spec.md)). This is the single tree anchor for the
  proposal; node `DQ`s (e.g. LS.SYS.STORE-DQ1) cross-reference it.

- **LS-DQ3 SQLite changeset ownership.**
  [RFC 0004](../contributor-docs/rfcs/0004-separate-sqlite-changesets-from-events.md)
  proposes removing SQLite changesets from event values and storing them with
  the node-local state they describe. The current implementation persists
  leader changesets separately but uses mutable event metadata for session
  rollback, making ownership and lifetime depend on event representation.
  Unresolved: whether to accept the separation and its lookup-key, retention,
  snapshot, and recovery contracts. The design and coined terms live in the
  RFC per
  [.decisions/0004-rfc-vrs-boundary.md](./.decisions/0004-rfc-vrs-boundary.md).
  This is the single tree anchor for the proposal; affected node `DQ`s
  cross-reference it.

All branch nodes are populated as drafts (2026-07-15); node-local design
questions live in each node's spec.
