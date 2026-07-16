# Determinism Verification — Requirements

Role: owns the evidence that materialization is deterministic — the
executable side of the same-log-same-state claim.

## Context

Builds on [../requirements.md](../requirements.md). The determinism contract
itself is owned by `../../02-state/`.

## Requirements

- **LS.SYS.VER.DET-R01 Determinism guards:** Materialization determinism is
  guarded by the runtime materializer-hash comparison (dev-mode, session vs
  leader — see `../../02-state/`) and by materializer unit tests. Re-homed
  from `LS.SYS.VER-R06`, which claimed test-based hash checks; no test
  asserts a materializer hash today. `refines: LS-R05`
- **LS.SYS.VER.DET-R02 Determinism oracle:** An executable oracle backs
  LS-R05: rematerializing the same eventlog twice — and across SQLite builds
  (wa-sqlite vs native) — yields state with an identical hash. Adopted
  2026-07-16 (interview); not yet built — see
  [.delta/DELTA-001-determinism-oracle-missing.md](./.delta/DELTA-001-determinism-oracle-missing.md).
  `refines: LS-R05`
