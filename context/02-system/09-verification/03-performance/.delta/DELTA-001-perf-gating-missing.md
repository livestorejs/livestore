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

A `perf-test` CI job already runs the suites (`.github/workflows/ci.yml`,
`test:perf --mode before`) but is **not** in `required_status_checks`, so a
regression cannot fail a PR today. Two gaps: (1) extend the
measurements-reporter to persist runs machine-readably (per machine class), add
baseline comparison, and codify budgets for the key latency/memory metrics,
failing the run on a budget breach; (2) promote `perf-test` to a required check.
Close when a regression beyond budget fails a required CI check.
