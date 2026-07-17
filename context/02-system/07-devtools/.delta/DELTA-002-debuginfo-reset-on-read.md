# DELTA-002 — DebugInfoHistory read resets shared debug state

Status: open

## Divergence

LS.SYS.DT-R11 requires inspection to be side-effect free for other readers.
`DebugInfoHistorySubscribe` violates this: each tick resets
`sqliteDbWrapper.debugInfo` to empty (`livestore/src/store/devtools.ts:167`),
starving any other consumer of the same struct (code TODO; issue #1421).

## VRS

[requirements.md](../requirements.md) LS.SYS.DT-R11 (adopted 2026-07-16,
interview); "known wart" note in [spec.md](../spec.md).

## Implementation Contract

Make debug-info collection cursor- or snapshot-based so reads do not clear
shared state (see issue #1421). Close this delta when
`DebugInfoHistorySubscribe` no longer mutates state observable to other
readers.
