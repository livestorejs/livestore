# Conformance — Requirements

Role: owns realization-independent conformance suites for the pluggable
dimensions — the executable side of "any realization of contract X works".

## Context

Builds on [../requirements.md](../requirements.md). The dimension contracts
themselves live in their owning nodes (`../../03-sync/`, `../../04-runtime/`,
`../../02-state/`, `../../08-integrations/`).

## Requirements

- **LS.SYS.VER.CONF-R01 Sync-provider conformance:** Every sync provider is
  verified against the shared suite driving the `SyncBackend` interface
  directly, not by provider-specific ad-hoc tests alone; the suite's assertion
  scope is specified in [spec.md](./spec.md). Re-homed from `LS.SYS.VER-R02`.
  `refines: LS-R08`
- **LS.SYS.VER.CONF-R02 Dimension conformance:** Each pluggable dimension
  (adapters, framework integrations, read-model realizations) has a
  realization-independent conformance suite a new realization must pass.
  Re-homed from `LS.SYS.VER-R03`.
- **LS.SYS.VER.CONF-R03 Adapter conformance:** Every platform adapter passes
  a shared conformance suite covering storage lifecycle, boot, and leader
  election. Adopted 2026-07-16 (interview); not yet built — see
  [.delta/DELTA-001-adapter-conformance-missing.md](./.delta/DELTA-001-adapter-conformance-missing.md).
  `refines: LS-R07`
- **LS.SYS.VER.CONF-R04 Framework-integration conformance:** Every framework
  integration passes a realization-independent binding conformance suite.
  Adopted 2026-07-16 (interview); not yet built — see
  [.delta/DELTA-002-framework-conformance-missing.md](./.delta/DELTA-002-framework-conformance-missing.md).
  `refines: LS-R09`
- **LS.SYS.VER.CONF-R05 Provider-suite hardening:** The sync-provider suite
  asserts reconnection-after-drop and auth-failure behavior for every
  provider in the matrix. Adopted 2026-07-16 (interview); not yet built —
  see
  [.delta/DELTA-003-provider-suite-assertion-gaps.md](./.delta/DELTA-003-provider-suite-assertion-gaps.md).
  `refines: LS-R08`
