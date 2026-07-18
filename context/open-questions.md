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

All branch nodes are populated as drafts (2026-07-15); node-local design
questions live in each node's spec.
