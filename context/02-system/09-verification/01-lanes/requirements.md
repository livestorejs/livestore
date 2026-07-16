# Verification Lanes — Requirements

Role: owns the taxonomy of runnable test lanes — what each lane proves, where
it lives, and how it is invoked locally and in CI.

## Context

Builds on [../requirements.md](../requirements.md). CI mechanics (runners,
workflows) are owned by `../../../03-delivery/`.

## Requirements

- **LS.SYS.VER.LANE-R01 Layered lanes:** Verification runs in distinct lanes —
  colocated unit tests, package integration, browser integration,
  sync-provider conformance, SQLite substrate, and performance suites — each
  runnable locally via a `mono test` verb (`unit`, `integration`,
  `sync-provider`, `wa-sqlite`, `perf`). Re-homed from `LS.SYS.VER-R01`.
- **LS.SYS.VER.LANE-R02 Package test floor:** Every published package has
  colocated unit tests or a documented exemption in [spec.md](./spec.md).
  Adopted 2026-07-16 (interview); not met — see
  [.delta/DELTA-001-zero-test-packages.md](./.delta/DELTA-001-zero-test-packages.md).
- **LS.SYS.VER.LANE-R03 Lane↔CI mapping:** The lane table maps each lane to
  exactly one `mono test`/devenv command, and the table stays in sync with
  the CI job decomposition. Adopted 2026-07-16 (interview); not met — see
  [.delta/DELTA-002-lane-ci-mismatches.md](./.delta/DELTA-002-lane-ci-mismatches.md).
