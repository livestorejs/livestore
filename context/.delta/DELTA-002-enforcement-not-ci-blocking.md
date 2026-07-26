# DELTA-002 — Intent-layer enforcement suite does not hard-block CI

Status: closed (2026-07-25) — resolved by removing the `Effect.ignore` outright.

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

## Resolution

The `Effect.ignore` was removed from the sequential loop entirely, so both
`tests/package-common` and `packages/@livestore/webmesh` now fail `test-unit`.
This supersedes the remedy proposed above — a dedicated non-ignored step for the
intent-layer suite — which would have left the rest of `tests/package-common`
swallowed.

Carving out only the intent-layer suite was rejected because the quarantine was
never scoped to the flake it was added for: it covered two complete targets, and
a survey of 20 `main` runs and 18 pull-request runs found no evidence of the
`webmesh` flakiness still occurring. Quarantining a specific test, if one proves
unreliable, is now a per-test declaration rather than a package-wide wrapper.
