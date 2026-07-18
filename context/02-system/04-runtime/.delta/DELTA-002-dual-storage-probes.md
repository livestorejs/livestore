# DELTA-002 — Two independent storage probes decide storage mode

Status: open

## Divergence

LS.SYS.RT-R16 requires one source of truth for the effective storage mode.
Today the client session and the leader worker probe OPFS availability
independently: the client probe decides the app-visible `storageMode` while
the leader probe decides the actual DB backing and boot warning
(`persisted-adapter.ts:216,535`; `make-leader-worker.ts:198-254`). In
principle the two can disagree, reporting a mode that does not match the
backing.

## VRS

[requirements.md](../requirements.md) LS.SYS.RT-R16 (adopted 2026-07-16,
interview); spec §Session Boot captures the dual-probe reality.

## Implementation Contract

Derive the app-visible mode from the leader's effective backing (e.g.
report it through boot info) or otherwise unify the probes. Close this
delta when one probe result is authoritative end to end.
