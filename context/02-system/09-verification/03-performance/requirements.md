# Performance Verification — Requirements

Role: owns the performance evidence for the interactive-grade claim —
store-level and eventlog-level measurement suites.

## Context

Builds on [../requirements.md](../requirements.md).

## Requirements

- **LS.SYS.VER.PERF-R01 Performance evidence:** The interactive-grade claim
  is backed by maintained perf suites (store-level and eventlog-level) that
  collect latency and memory measurements from a real browser app. Re-homed
  from `LS.SYS.VER-R04`. `refines: LS-R14`
- **LS.SYS.VER.PERF-R02 Comparable measurements and regression budget:**
  Per-run measurements are persisted in machine-readable, cross-run
  comparable form, and CI fails on regression beyond a codified budget.
  Adopted 2026-07-16 (interview); not yet built — see
  [.delta/DELTA-001-perf-gating-missing.md](./.delta/DELTA-001-perf-gating-missing.md).
  `refines: LS-R14`
