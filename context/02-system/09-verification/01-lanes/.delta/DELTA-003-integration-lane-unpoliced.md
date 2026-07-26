# DELTA-003 — Browser integration lane bypasses the test policy

Status: open

## Divergence

LS.SYS.VER.LANE-R04 requires that tolerating a failing test is expressible only
as a declared quarantine. The `runTestTarget` helper enforces this for the
targets the `mono test` runner invokes directly (unit, sync-provider, SQLite
substrate, perf), but the browser integration lane is dispatched through
`@local/tests-integration`'s `runMiscTest` / `runTodomvcTest` /
`runDevtoolsTest`, which call Playwright without passing through the helper.

A suppression added inside that module would therefore not require a ledger
entry, and would not be rejected by the type checker.

## VRS

[spec.md](../spec.md) §Test Policy.

## Close condition

Route the integration lane's invocations through `runTestTarget`, so every lane
in the table above is covered by the same policy. Close when adding an
`Effect.ignore` to an integration-lane invocation fails to compile without a
ledger entry, the same way it now does for the other lanes.
