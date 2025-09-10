# Task: Investigate Node-Sync Test Teardown/Shutdown Flake (H007)

## Goal
Identify and eliminate causes where node-sync integration tests appear to run correctly but the suite or job still times out, suggesting lingering handles/processes or teardown ordering issues (Wrangler/dev server, CF DO WS/RPC, logger RPC server, worker pools, child processes).

## Context & Signals
- CI runs show cases where work completes, yet the suite hits the global 10m timeout. In other runs, long “approaching timeout” warnings occur near the end.
- We’ve seen both: a) one of the tests timing out (smoke or prop), and b) occasional "tests ran properly then timed out" behavior indicating shutdown/teardown flakiness.

References
- Tests: `tests/integration/src/tests/node-sync/node-sync.test.ts`
- Logger fixture: `tests/integration/src/tests/node-sync/fixtures/file-logger.ts`
- Wrangler dev server: `packages/@livestore/utils-dev/src/node/WranglerDevServer/WranglerDevServer.ts`
- CF DO WS stack: `packages/@livestore/common-cf/src/ws-rpc/ws-rpc-server.ts`, `packages/@livestore/sync-cf/src/cf-worker/do/*`
- Child processes: `@livestore/utils/node` (`ChildProcessWorker.layer`, Worker pools)

## Hypotheses to Test
1) Worker pool / child process not closed
   - ChildProcessWorker forks a node process per client; on completion those must be signaled and awaited.
   - The Effect Worker pool should close on scope end; if the scope leaks, processes/streams may remain.

2) Logger RPC server not shutting down cleanly
   - `makeFileLogger` starts an HTTP RPC server; the layer is scoped. Ensure the scope ends and the port closes.
   - If `LOGGER_SERVER_PORT` env is reused across tests or the server remains listening, teardown may hang.

3) Wrangler/workerd processes not terminated promptly
   - `WranglerDevServerService` starts `bunx wrangler dev` and attempts to kill the process tree in a finalizer. Verify PID cleanup on success and on interruption.
   - Streams (stdout/stderr) may need draining; check broadcaster shutdown path.

4) CF DO WS/RPC lingering connections
   - Ensure WS connections (client and server) are closed at test end.
   - We added logging to `webSocketClose`; confirm close events are seen.

5) Test harness race between completion and teardown
   - The tests race `exec` (stream completion) with an `OnShutdown` signal. Confirm both tests exit their Effect scopes deterministically, not leaving pending fibers.

## Reproduction (Local)
- Use CLAUDE.md flow:
  - `direnv allow`
  - `direnv exec . mono test integration node-sync`
- Stress long/near-timeout conditions:
  - `taskset -c 0 direnv exec . mono test integration node-sync`
  - Increase seeds: `NODE_SYNC_FC_NUMRUNS=10 direnv exec . mono test integration node-sync`
- Targeted:
  - Run only the smoke test (vitest `--testNamePattern`) repeatedly to surface teardown issues after short runs.
- Inspect:
  - `tests/integration/tmp/logs/*.log` for final messages, and whether "after" hooks log as expected.

## Plan of Attack
1) Instrument teardown lifecycle (temporary)
   - Add `afterEach/afterAll` logging in `node-sync.test.ts` to mark teardown phases: “begin shutdown”, “close worker pool”, “close logger”, “kill wrangler”, “done”.
   - Add logs inside `WranglerDevServerService` finalizer (already has some) and ensure we see "Cleaned up ... processes" on CI.

2) Ensure explicit shutdown where helpful
   - Worker pool: if API supports explicit `close`/`shutdown`, call it in `afterEach`. Otherwise, wrap in an Effect scoped block and ensure scope is closed.
   - Logger: ensure logger RPC layer scope ends per test (it should via withTestCtx). If not, add an explicit close handle.
   - Wrangler: confirm finalizer runs even on interruption; add timeout fallback to SIGKILL (it exists). Surface PIDs/exit codes in logs.
   - WS connections: ensure client sockets close; log close events on both sides.

3) Bound CI load for determinism (already landed for hypothesis branches)
   - Keep `NODE_SYNC_MAX_CREATE_COUNT` and `NODE_SYNC_MAX_LEADER_PUSH_BATCH_SIZE` caps in CI for now to reduce long tails while diagnosing teardown.

4) Isolate whether timeouts are due to lingering handles or test timeout thresholds
   - Temporarily bump smoke test timeout in CI to distinguish “just slow” from “stuck in teardown”.
   - If a higher timeout completes reliably, re-evaluate caps/timeouts and revert once teardown is proven clean.

## Concrete Tasks
- [ ] Add afterEach/afterAll teardown logs in `node-sync.test.ts` (temporary diagnostics)
- [ ] Verify Worker pool/ChildProcessWorker can be explicitly closed; add explicit shutdown call
- [ ] Confirm logger RPC server scope ends; if needed, add explicit close in test
- [ ] Record Wrangler PID and confirm kill in finalizer; surface logs on CI
- [ ] Log WS close events on both sides for final connections
- [ ] Run CI with current caps; analyze whether timeouts persist post-tests
- [ ] If needed, bump smoke test timeout in CI (temporary) to decouple slow teardown from genuine hangs
- [ ] Produce minimal, steady-state teardown solution and remove diagnostics

## Acceptance Criteria
- Node-sync job reliably finishes without suite-level timeouts when work is done
- No lingering processes or ports after tests (verified via logs)
- No regression in other integration suites

## Deliverables
- Branch: `ci-node-sync-hypo/h007-shutdown-flake`
- PR targeting `dev` with:
  - Explicit teardown changes (Worker pool and logger/wrangler/WS shutdown)
  - Temporary teardown diagnostics (to be removed post-verify)
  - Optional CI smoke-test timeout bump (temporary)

## Useful Commands
- Build: `direnv exec . mono ts`
- Run node-sync only: `direnv exec . mono test integration node-sync`
- Target smoke test: `direnv exec . vitest run tests/integration/src/tests/node-sync/node-sync.test.ts --testNamePattern "create 4 todos"`
- CPU pinning (simulate CI scheduling): `taskset -c 0 ...`

