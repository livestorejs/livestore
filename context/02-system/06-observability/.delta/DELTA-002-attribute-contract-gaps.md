# DELTA-002 — Span attributes are ad hoc and query text is ungated

Status: open

## Divergence

LS.SYS.OBS-R06 requires namespaced, enumerated attribute keys with
query-text attributes gated behind a debug flag. Today (see the spec's
attribute inventory): only `livestore.manualRefreshLabel` is namespaced;
`sql.query`, `sql.rowsCount`, `sql.cached`, `span.label`, and `batchSize`
are ad hoc; `sql.query` carries full query text into app exporters
unconditionally — a PII/exposure surface.

## VRS

[requirements.md](../requirements.md) LS.SYS.OBS-R06 (adopted 2026-07-16,
interview).

## Implementation Contract

Namespace all LiveStore-emitted attribute keys (e.g. `livestore.sql.query`),
enumerate them in the spec inventory, and emit query-text attributes only
when a debug flag is set. Close this delta when the emitted keys match the
inventory and `sql.query` is flag-gated.
