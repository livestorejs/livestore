# DELTA-001 — Performance gating not built

Status: open

## Divergence

LS.SYS.VER.PERF-R02 requires persisted, comparable per-run measurements and
a CI-failing regression budget. Today the suites (`tests/perf/`,
`tests/perf-eventlog/`) assert DOM correctness only; timings flow through
PerformanceObserver into the measurements-reporter, which prints per-run
tables with no baseline storage, no cross-run comparison, and no threshold
that can fail a run.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.PERF-R02 (adopted
2026-07-16, interview).

## Implementation Contract

Extend the measurements-reporter to persist runs machine-readably (per
machine class), add baseline comparison, and codify budgets for the key
latency/memory metrics; wire a CI failure on budget breach. Close when a
regression beyond budget fails CI.
