# DELTA-001 — Database import is not devtools-attributed

Status: open

## Divergence

LS.SYS.DT-R09 requires every state-mutating devtools operation to be
attributable as devtools-originated. `CommitEventReq` conforms (events are
committed with origin `devtools-${clientId}`, `leader-worker-devtools.ts:345`),
but `LoadDatabaseFile` (state/eventlog import, forces shutdown;
`leader-worker-devtools.ts:202`) leaves no devtools-origin marker in the
imported data — an import is indistinguishable from organically produced state
afterwards.

## VRS

[requirements.md](../requirements.md) LS.SYS.DT-R09 (adopted 2026-07-16,
interview); control-operation table in [spec.md](../spec.md).

## Implementation Contract

Record a devtools-origin marker for database imports (e.g. an import event
or metadata entry carrying `devtools-${clientId}` and a timestamp). Close
this delta when an imported database is attributable after the fact.
