# Task: Reproduce, Diagnose, and Fix H001 (Advance-Only Push Stall) Locally

Owner: Secondary agent (local focus)
Related PRs/Branches:
- Baseline diagnostics: `ci-node-sync-hypo/h001-baseline-logs` (PR #613)
- Experiment (guarded fix): `ci-node-sync-hypo/h001-resume-on-advance` (PR #614)

## Goal
Produce a minimal, local reproduction of the node-sync CI flake attributed to H001 (push fiber stalls when upstream only advances, without a rebase). Identify the precise root cause in `LeaderSyncProcessor` and implement a robust fix with tests.

Concretely, demonstrate that:
1) Under certain timing/sequence conditions, the push loop stops progressing after upstream-only advances.
2) The stall correlates with the backend pushing fiber being left in a state that does not resume (e.g., returned `Effect.never` and not re-launched).
3) A safe change restores progress (resume on upstream advance or an equivalent) without regressions.

## Repo Areas of Interest
- Pushing/pulling control loops: `packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts`
  - Functions: `backgroundBackendPushing`, `backgroundBackendPulling`
  - Hooks: `restartBackendPushing` is currently invoked on upstream rebase; experiment branch invokes it on advance too.
- Integration tests to drive real flows:
  - `tests/integration/src/tests/node-sync/node-sync.test.ts`
  - Wrangler DO fixture: `tests/integration/src/tests/node-sync/fixtures`

## Environment Setup
Assumptions: Nix devshell or equivalent setup used by this repo (see `.github/actions/setup-env`).

Quick start:
- Ensure direnv/Nix shell if you use it locally; otherwise use Bun/Node as per repo tooling.
- Validate toolchain:
  - `node -v` (>= 20)
  - `bun --version`
  - `pnpm -v` (if using pnpm)

Install/build (choose one path):
- Nix/devshell path: open the dev shell as done in CI.
- Traditional path: `pnpm i -w` then `pnpm run build:ts` (or via `bun` if configured).

## Local Reproduction (Baseline Behavior)
We want to simulate CI-like conditions and surface advance-only sequences.

1) CI-like run of just node-sync tests with logs enabled
- Command:
  - `CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 mono test integration node-sync`
  - Or: `CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 pnpm vitest run tests/integration/src/tests/node-sync/node-sync.test.ts --reporter verbose`
- Where logs go: `tests/integration/tmp/logs/*.log`

2) Speeding up iteration
- You can reduce fast-check runs for the property-based test:
  - `NODE_SYNC_FC_NUMRUNS=3 CI=1 mono test integration node-sync`

3) Expected baseline signals (from CI and our diagnostics):
- Repeated `pull-advance` entries; no `pull-rebase` before timeout
- No `backend-push-error` and (historically) no progress from pushing loop
- Test timing out (not crashing)

4) Optional parameters to increase concurrency/timing pressure
- In `node-sync.test.ts`, the prop test randomizes:
  - `todoCountA/B`, `commitBatchSize`, `leaderPushBatchSize`, and `simulationParams`.
- Try larger `leaderPushBatchSize` with mixed commit batch sizes; or use the default property test and rely on multiple runs.

## Root-Cause Investigation Checklist
Focus on `LeaderSyncProcessor` behavior transition when upstream advances without a rebase.

1) Understand current pushing loop fail path
- In `backgroundBackendPushing`, on push failure it logs a handled error and returns `Effect.never`, relying on an interrupt from pulling to restart.
- Today, `restartBackendPushing` is called on upstream rebase. Advance-only might not trigger restart.

2) Instrumentation already available
- Logs we added (baseline branch):
  - `pull-advance`, `pull-rebase` with merge counters
  - `backend-push-error` with type, batch sizes
  - `local-push-reject` with expected/provided ids
  - `backend-push-batch` size
- Inspect `tests/integration/tmp/logs/*.log` after runs.

3) What to verify locally
- That on a run showing repeated `pull-advance`, no `backend-push-batch` appears afterwards (or stalls early), while no rebase happens.
- That the pushing fiber was not re-launched after the advance-only sequence.

4) Optional targeted probes (temporary; do not commit):
- Add logs around FiberHandle lifecycle in `LeaderSyncProcessor.ts` when we start/clear/restart the pushing fiber.
- Add logs when `localPushesLatch`/`pullLatch` open/close.

## Implementing the Fix
Two candidate strategies:

Option A (Minimal & Confirmed by Experiment):
- Resume pushing when upstream advances (not just on rebase).
- Implementation model (see experiment branch): on advance, compute global pending and call `restartBackendPushing(globalPending)`.

Option B (Structural):
- Avoid returning `Effect.never` on push error — instead, put the pushing loop behind a robust supervisor that restarts on any upstream change, whether advance or rebase, and consider time-based retry if needed.
- This can be riskier; start with Option A if experiment shows success.

Guarding behavior change:
- Initially behind `LS_RESUME_PUSH_ON_ADVANCE=1` with tests enabling it; after validation, consider making it default.

## Testing the Fix
1) Deterministic-ish repro case:
- Reduce runs via `NODE_SYNC_FC_NUMRUNS=3`.
- Keep property test active; aim to observe that prior advance-only timeouts now complete.

2) Targeted regression test idea:
- Simulate an upstream-only advance sequence followed by checking that pushing resumes.
- Could be done by crafting a small test using the same worker infra but forcing a known sequence (smaller counts, specific batch sizes, and simulation delays).

3) Run matrix locally:
- Baseline (flag OFF): ensure no regressions where things already passed locally.
- Flag ON: confirm that previously failing sequences complete in reasonable time; verify no rebase-only dependency remains.

## Acceptance Criteria
- Repro: Local run can show advance-only stalls on baseline.
- Diagnosis: Clear evidence that pushing fiber does not resume after advance-only sequences.
- Fix: With the flag ON, the same scenario no longer stalls; tests pass without timeouts.
- Safety: No regressions in unit/integration suites; CI artifacts/logs confirm improvement.
- Documentation: Commit message and PR description explain the root cause and why the fix is correct.

## Deliverables
- Branch: `ci-node-sync-hypo/h001-local-fix` (or similar)
- PR targeting `dev`
- Changes:
  - Code fix in `LeaderSyncProcessor.ts` (behind env flag initially)
  - A minimal test addition validating pushing resumes on upstream advance
  - Noisy debug logs removed or guarded for CI-only diagnostics

## Useful Commands
- Run node-sync locally:
  - `CI=1 DEBUGGER_ACTIVE=0 NODE_SYNC_DEBUG=1 mono test integration node-sync`
- Faster iterations:
  - `NODE_SYNC_FC_NUMRUNS=3 CI=1 mono test integration node-sync`
- Inspect logs:
  - `ls tests/integration/tmp/logs/*.log`
  - `rg -n "pull-(advance|rebase)|backend-push-batch|backend-push-error|local-push-reject" tests/integration/tmp/logs`

## Notes & Caveats
- Do not check in temporary, verbose instrumentation beyond what’s already guarded.
- Prefer minimal, reversible changes first; prove correctness with tests.
- Coordinate with existing experiment PR (#614) — if results are conclusive, merge a cleaned-up version without CI-only switches.

