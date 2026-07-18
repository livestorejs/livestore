# DELTA-002 — Intent-layer enforcement suite does not hard-block CI

Status: open

## Divergence

The intent-layer enforcement suite
(`tests/package-common/src/intent-layer/intent-layer.test.ts`) is meant to gate
the tree's mechanical invariants (LS-R15). It runs in the CI `test-unit` job,
but its failures are **swallowed**: `tests/package-common` is listed in the CI
runner's `sequentialPackages` and each sequential package is executed through
`.pipe(Effect.ignore, …)` when `GITHUB_ACTIONS=true`
(`scripts/src/commands/test-commands.ts:184,197-200`). The `Effect.ignore` was
added for flaky `webmesh` tests, but it also swallows this suite's failures — so
a broken invariant is logged, not gated. (Surfaced by a Codex review of #1406.)

Locally (`mono test unit`, or running the file directly) the suite fails as
expected; only the CI wrapper drops the failure.

## VRS

[spec.md](../spec.md) §Enforcement.

## Close condition

Run the intent-layer suite as a dedicated **non-ignored** step in the
`test-unit` path — e.g. a `vitest run tests/package-common/src/intent-layer`
invocation outside the `Effect.ignore`'d sequential loop — so a failing
invariant fails the job, without un-ignoring the genuinely-flaky `webmesh` /
`package-common` tests. Close when a deliberately-broken invariant reds
`test-unit` in CI. (Deferred here as a CI-runner change requiring a working
`devenv`/`mono` env to verify; the shared effect-utils store is currently
dirtied by a concurrent tsgo-bump workstream.)
