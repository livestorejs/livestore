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
  asserts a materializer hash today (see LS.SYS.VER.DET-DQ1).
  `refines: LS-R05`
