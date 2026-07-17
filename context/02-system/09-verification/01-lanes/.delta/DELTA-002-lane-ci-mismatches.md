# DELTA-002 — Lane table and CI decomposition mismatch

Status: closed (2026-07-17) — resolved by correcting the lane table.

## Resolution

The asserted table↔CI mismatch did not actually exist: each lane maps 1:1 to its
CI job (Unit→`test-unit`, Browser→`test-integration-playwright`,
Sync-provider→`test-integration-sync-provider`, SQLite→`wa-sqlite-test`,
Perf→`perf-test`), and the examples row was already present in the table. The
only real inaccuracy was the local-command column: `tests/sync-provider/` and
`tests/wa-sqlite/` are subcommands of `integration`
(`mono test integration {sync-provider,wa-sqlite}`,
`scripts/src/commands/test-commands.ts`), not top-level `mono test {…}` verbs.
That column is corrected in [spec.md](../spec.md) §Lane / CI Correspondence.

The `integration` CLI grouping and the package-common-folds-into-unit /
examples-on-demand behaviors are intended, documented characteristics — not
LS.SYS.VER.LANE-R03 violations.

## VRS

[requirements.md](../requirements.md) LS.SYS.VER.LANE-R03.
