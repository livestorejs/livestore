# Performance Verification — Spec

This document specifies the performance suites. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Current Mechanism (captured 2026-07-16)

- **Store perf** — `tests/perf/`: a Playwright-driven test app with latency
  and memory suites. The `expect` assertions check DOM correctness only (row
  visibility/text); timings are collected via `PerformanceObserver` and
  written by `tests/perf/tests/measurements-reporter.ts`.
- **Eventlog perf** — `tests/perf-eventlog/`: a Playwright test app with an
  event-streaming suite, same measurement-collection pattern.
- CI job `perf-test` runs the store suite.

The reporter prints per-run tables; there is no baseline storage, no
cross-run comparison, and no threshold that can fail a run. Perf runs today
produce *measurements*, not *verdicts*. Gating is now contracted
(LS.SYS.VER.PERF-R02;
[DELTA-001](./.delta/DELTA-001-perf-gating-missing.md)).

## Open Design Questions

- **LS.SYS.VER.PERF-DQ1 Budget values.** Which concrete latency/memory
  budgets back LS.SYS.VER.PERF-R02, and per which machine classes — needs
  baseline data before numbers can be codified. Narrowed 2026-07-16 from
  the broader gating question.
