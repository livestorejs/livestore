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
