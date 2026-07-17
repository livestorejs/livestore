# DELTA-002 — Span attributes are ad hoc and query text is ungated

Status: open

## Divergence

LS.SYS.OBS-R06 requires namespaced, enumerated attribute keys with
query-text attributes gated behind a debug flag. Most emitted keys are now
namespaced (`livestore.commitLabel`, `livestore.debugRefreshReason`,
`livestore.eventTags`, `livestore.eventsCount`, `livestore.eventLog.since/until`,
`livestore.streamEvents.*`, `livestore.manualRefreshLabel`), but several remain
ad hoc — `sql.query`, `sql.rowsCount`, `sql.cached`
(`SqliteDbWrapper.ts:179,252,257,258,271,272`), `span.label`, and `batchSize` —
and `sql.query` carries full query text into app exporters unconditionally
(`SqliteDbWrapper.ts:179,252`), a PII/exposure surface.

## VRS

[requirements.md](../requirements.md) LS.SYS.OBS-R06 (adopted 2026-07-16,
interview).

## Implementation Contract

Namespace all LiveStore-emitted attribute keys (e.g. `livestore.sql.query`),
enumerate them in the spec inventory, and emit query-text attributes only
when a debug flag is set. Close this delta when the emitted keys match the
inventory and `sql.query` is flag-gated.
