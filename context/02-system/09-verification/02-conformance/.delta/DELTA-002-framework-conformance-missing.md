# DELTA-002 — Framework-integration conformance suite not built

Status: open

## Divergence

LS.SYS.VER.CONF-R04 requires a realization-independent binding conformance
suite for framework integrations. None exists; react has colocated hook
tests only, and `framework-toolkit` (the shared primitive layer) has zero
tests.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.CONF-R04 (adopted
2026-07-16, interview).

## Implementation Contract

A suite driving the `framework-toolkit` contract (normalizeQueryable,
query-resource lifecycle, rc-key scoping) plus per-integration binding
assertions (subscribe/unsubscribe balance, commit-atomic update delivery,
store switching) runnable against any integration. Close when react (and
at least the toolkit layer) run it in CI.
