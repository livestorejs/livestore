# H001: Shared CI main-step hang across namespace runners

## Problem Statement

`livestore` PR `#1125` has workflow runs where many unrelated jobs enter their first real `devenv tasks run ... --mode before` step and then remain `in_progress` for hours.

## Current Status

In progress.

## Context & Environment

- Repo: `livestore`
- Main affected run: `23597026954`
- Debug branch/worktree: `schickling/debug-ci-run-hang`
- Shared wrapper under test: `repos/effect-utils/genie/ci-workflow.ts`

## Experiments

### Observation: broad hang pattern in CI

- `lint`, `type-check`, `test-unit`, `perf-test`, multiple Playwright jobs, docs, examples, and sync-provider jobs all reached their main task step around `2026-03-26 13:33Z` to `13:35Z`.
- Those jobs were running on different `nsc-runner-*` machines.
- This makes a single test-suite regression unlikely as the primary cause.

### Observation: prior perf reporter bug was real but not sufficient

- `tests/perf/tests/measurements-reporter.ts` previously threw `AsyncFiberException` under Playwright sync hooks.
- That was fixed on the main branch in commit `b01cddc45`.
- The broad CI hang pattern persisted afterwards.

### Observation: local repro does not yet match CI-wide hanging behavior

- Local CI-shaped invocations with an unreachable OTLP endpoint did not reproduce the same universal hang.
- Some commands failed quickly, but they did not stall for hours after entering the main task step.

## Conclusions / Findings

- The current evidence points to a shared wrapper or runner-level interaction rather than a specific `livestore` task implementation.
- The existing heartbeat messages confirm elapsed time, but they do not expose the process tree, child PIDs, or recent command output, so they are insufficient to distinguish between slow work, blocked children, or runner-side log/control-plane issues.

## New Hypotheses To Try

1. The wrapped `devenv` command is still doing real work, but CI lacks enough visibility to show which child process is active.
2. The wrapper and GitHub runner interaction leaves a descendant process blocked while the parent shell remains alive.
3. Namespace runners are hitting a shared infrastructure issue, and the wrapper needs to expose enough process and output state to prove that.

## Solution Proposals

1. Add debug-only wrapper instrumentation that captures combined output, prints recent output tails, and emits process snapshots for the wrapped command PID tree on each heartbeat.
2. Run that instrumentation on a separate debug branch/PR so the extra logging does not pollute PR `#1125`.

## General Improvement Suggestions

- Keep a debug mode in the CI wrapper that can be enabled per-branch without editing the underlying task graph.
- Persist wrapper-side command logs in a predictable location so they can be uploaded when jobs fail or are manually cancelled.
