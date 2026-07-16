# Protocol Compatibility — Requirements

Role: owns executable compatibility verification for versioned protocols.

## Context

Builds on [../requirements.md](../requirements.md). The protocols themselves
are owned by `../../07-devtools/` (devtools protocol) and `../../03-sync/`
(sync wire messages).

## Requirements

- **LS.SYS.VER.PROTO-R01 Devtools protocol compatibility:** The devtools
  protocol keeps an executable compatibility test that fails on undeclared
  breaking version-handling changes. Re-homed from `LS.SYS.VER-R05`, which
  also claimed a sync-protocol compatibility test — none exists (see
  LS.SYS.VER.PROTO-DQ1).
