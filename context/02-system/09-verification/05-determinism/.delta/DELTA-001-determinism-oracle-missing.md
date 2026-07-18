# DELTA-001 — Determinism oracle not built

Status: open

## Divergence

LS.SYS.VER.DET-R02 requires an executable determinism oracle
(rematerialize-twice + cross-SQLite-build state-hash equivalence). No such
test exists; determinism evidence today is the dev-mode runtime hash guard
plus example-based materializer unit tests (LS.SYS.VER.DET-R01).

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.DET-R02 (adopted
2026-07-16, interview).

## Implementation Contract

Add to the determinism lane: a test that (a) materializes an eventlog
fixture, rematerializes from scratch, and asserts identical state hashes;
(b) runs the same assertion across SQLite builds (wa-sqlite WASM vs native)
where the test environment allows. Close this delta when the test runs in
CI.
