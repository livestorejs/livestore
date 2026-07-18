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
  also claimed a sync-protocol compatibility test — none existed.
- **LS.SYS.VER.PROTO-R02 Sync wire compatibility:** An executable test fails
  on undeclared breaking changes to sync wire messages/schemas. Adopted
  2026-07-16 (interview); not yet built — see
  [.delta/DELTA-001-sync-wire-compat-missing.md](./.delta/DELTA-001-sync-wire-compat-missing.md).
  Tension: the wire is currently unversioned (structural decoding only, see
  `../../03-sync/03-cf/`), so satisfying this may force introducing an
  explicit wire version.
