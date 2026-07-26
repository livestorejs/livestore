# DELTA-003 — Parts of the browser integration lane bypass the test policy

Status: open

## Divergence

LS.SYS.VER.LANE-R04 requires that tolerating a failing test is expressible only
as a declared quarantine. `runTestTarget` enforces that for the unit lane,
sync-provider, the SQLite substrate, perf, and the DevTools browser cell — the
last via a wrapper in `scripts/src/commands/test-commands.ts` carrying the
`devtools-suite` ledger entry.

Three invocation paths remain outside it:

- The `misc` and `todomvc` browser cells register `@local/tests-integration`'s
  commands directly, so neither states a policy.
- `mono test integration all` calls `runDevtoolsTest` without the wrapper, so the
  DevTools quarantine applies on the CI path but not the aggregate one. The same
  suite behaves differently depending on which command reached it.
- `@local/tests-integration` exposes its own unwrapped CLI entrypoint.

## VRS

[spec.md](../spec.md) §Test Policy.

## Close condition

Route every browser-integration invocation through `runTestTarget`, so a suite's
policy does not depend on how it was invoked. Close when `mono test integration
all` and the `misc`/`todomvc` cells apply the same policy as the DevTools cell.
