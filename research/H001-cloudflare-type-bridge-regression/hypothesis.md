# H001 Cloudflare Type Bridge Regression

## Problem Statement

The branch currently needs two separate changes to get type checking back to green:

1. `react-error-boundary` needs `gvsTypeExtensions` so its React types resolve correctly under pnpm GVS.
2. `packages/@livestore/common-cf/src/declare/cf-declare.ts` must use the newer `cfGlobalThis` bridge instead of directly reading `globalThis.ReadableStream`.

The user called out prior regressions around Cloudflare types, so the goal is to understand whether the newer `cfGlobalThis` bridge is actually the safe minimal fix, and which parts of the broader Cloudflare typing cleanup were risky.

## Current Status

In progress.

## Context & Environment

- Branch: `schickling/pnpm-11-from-effect-utils`
- Workspace: `livestore`
- Current date: 2026-03-27
- Relevant files:
  - `packages/@livestore/common-cf/src/declare/cf-declare.ts`
  - `tests/integration/src/tests/adapter-cloudflare/fixtures/worker.ts`
  - `packages/@livestore/adapter-cloudflare/**`
  - `packages/@livestore/sync-cf/**`

## Experiments

1. Reintroduce the older `globalThis.ReadableStream` bridge and rerun workspace typecheck.
2. Restore the newer `cfGlobalThis` bridge and rerun targeted type checks.
3. Inspect git history for both `cf-declare.ts` and the Cloudflare integration worker fixture.
4. Compare which regressions come from the shared bridge versus the worker fixture typing changes.

## Conclusions / Findings

- The `react-error-boundary` failure was unrelated to Cloudflare. It required `gvsTypeExtensions` under pnpm GVS.
- The remaining Cloudflare failure did **not** come from pnpm GVS. It came from the older `cf-declare.ts` implementation directly accessing `globalThis.ReadableStream`.
- `packages/@livestore/common-cf/tsconfig.json` uses `lib: ["ES2024"]` with `types: ["@cloudflare/workers-types"]` and intentionally does not include `lib.dom`. In that compiler environment, `globalThis.ReadableStream` is not available on the type of `globalThis`, which explains the local `TS2339`.
- The newer `cfGlobalThis` bridge introduced in commit `e542364b6` is a compile-time widening only. It does not change runtime behavior, but it does avoid the broken assumption that `globalThis` already exposes those members in this package's TS environment.
- The March 2026 worker-fixture typing changes (`makeCfResponse`, `DurableObjectBase`, explicit `CfTypes.Request`/`CfTypes.Response`) were a separate fix path in `tests/integration/src/tests/adapter-cloudflare/fixtures/worker.ts`. Those changes were **not** part of the shared bridge fix.
- `origin/dev` still carries the older worker-fixture shape, while the production `packages/@livestore/sync-cf/src/cf-worker/do/durable-object.ts` continues to use `CfDeclare`-backed runtime class redeclarations and a `DurableObjectBase` cast. That means the shared package surface is already built around the `CfDeclare` bridge model.
- Current targeted validation with:
  - restored `ErrorBoundary` wrappers
  - `gvsTypeExtensions` for `react-error-boundary`
  - newer `cfGlobalThis` bridge
  - old `origin/dev`-style worker fixture
  shows no remaining TS errors in:
  - `packages/@livestore/common-cf/tsconfig.json`
  - `docs/src/content/_assets/code/tsconfig.json`
  - `tests/integration/tsconfig.json`
- Therefore the safest current boundary is:
  - keep the newer `cfGlobalThis` bridge in `common-cf`
  - keep the worker fixture on the `origin/dev` shape unless there is a separate reason to revisit it
  - treat further worker-fixture cleanups as an independent refactor, not as part of the shared bridge fix

## Draft Follow-up Hypotheses

- H002: the real problem is mixed DOM/Workers global lib coverage, and `cfGlobalThis` is only masking a deeper tsconfig inconsistency.
- H003: the worker fixture typing cleanup changed runtime-adjacent type expectations and could regress compatibility independently of the shared `CfDeclare` bridge.

## Improvement Suggestions

- Add a dedicated targeted typecheck for the Cloudflare bridge package so this class of failure surfaces without rebuilding the full workspace.
- Keep Cloudflare bridge typing changes isolated from fixture/runtime typing refactors so regressions are easier to bisect.
- Add a small compile-only regression test or smoke task for `cf-declare.ts` that asserts the bridge compiles under the package's real `lib: ["ES2024"]` + `workers-types` configuration.
