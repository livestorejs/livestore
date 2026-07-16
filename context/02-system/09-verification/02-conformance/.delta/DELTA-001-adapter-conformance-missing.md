# DELTA-001 — Adapter conformance suite not built

Status: open

## Divergence

LS.SYS.VER.CONF-R03 requires a shared adapter conformance suite (storage
lifecycle, boot, leader election). None exists; adapter coverage rests on
per-adapter browser-integration tests (`tests/integration/`) and the
adapters have zero colocated unit tests.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.CONF-R03 (adopted
2026-07-16, interview).

## Implementation Contract

A registry-driven suite (mirroring `tests/sync-provider/`) that runs the
same spec set over every in-repo adapter (web persisted/single-tab/
in-memory, cloudflare) asserting: adapter boots a client session, persisted
state survives leader restart, exactly one leader per client under
contention, and shutdown propagates. Close when the suite runs in CI over
all in-repo adapters.
