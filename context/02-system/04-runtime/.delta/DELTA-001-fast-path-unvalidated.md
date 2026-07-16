# DELTA-001 — Fast-path snapshot trusted without validation

Status: open

## Divergence

LS.SYS.RT-R15 requires fast-path-derived head/state to be validated against
what the leader would report. Today the web fast path reads the persisted
state DB directly from OPFS and derives `leaderHead` from
`SESSION_CHANGESET_META_TABLE`, while the leader derives its head from the
eventlog — two sources that can diverge. The snapshot is trusted without
validation (code TODO, `adapter-web/src/web-worker/client-session/
persisted-adapter.ts:237`).

## VRS

[requirements.md](../requirements.md) LS.SYS.RT-R15 (adopted 2026-07-16,
interview); spec §Session Boot captures the dual-source reality.

## Implementation Contract

On fast-path boot, verify the derived head (and, cheaply, the snapshot
identity) against the leader once it is reachable; on mismatch fall back to
the slow path instead of proceeding on divergent state. Close this delta
when the validation exists and is exercised by a test.
