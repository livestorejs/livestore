# Verification — Requirements

Defines how LiveStore proves its own contracts: test architecture,
conformance suites for the pluggable dimensions, and performance evidence.
Refines the realization-proving and performance criteria of the root
([LS-R08], [LS-R14]; vision success criterion 6).

## Context

Builds on [../requirements.md](../requirements.md) (`LS.SYS-*`). CI
mechanics (runners, workflows) are owned by `../../03-delivery/`; this node
owns what is verified and by what kind of evidence.

## Requirements

- **LS.SYS.VER-R01 Layered lanes:** Verification runs in distinct lanes —
  colocated unit tests (Vitest), cross-package integration tests
  (Playwright-driven), and performance suites — each runnable locally via one
  command (`mono test <unit|integration|perf>`).
- **LS.SYS.VER-R02 Sync-provider conformance:** Every sync provider is verified
  against the shared suite exercising the `SyncBackend` interface (connection
  management, push/pull ordering, reconnection), not by provider-specific
  ad-hoc tests alone. `refines: LS-R08`
- **LS.SYS.VER-R03 Dimension conformance:** Each pluggable dimension (adapters,
  framework integrations, read-model realizations) has a
  realization-independent conformance suite a new realization must pass.
- **LS.SYS.VER-R04 Performance evidence:** The interactive-grade claim is
  backed by maintained perf suites (store-level and eventlog-level) with
  comparable measurements across runs. `refines: LS-R14`
- **LS.SYS.VER-R05 Protocol compatibility tests:** Versioned protocols
  (devtools, sync) keep executable compatibility tests that fail on undeclared
  breaking changes.
- **LS.SYS.VER-R06 Determinism checks:** Materialization determinism is guarded
  by tests (e.g. materializer hash checks) rather than convention.
  `refines: LS-R05`
