# LiveStore Streaming Perf Harness

The `perf-eventlog` performance tests are focused on event streaming. These tests still require more work before they can be integrated into any meaningfull tracking in CI for regression detection. Current use-case is for performance tracking during the development of the eventStream functionality.

**TODO**:

- Meassure CPU usage metrics
- Meassure memory consumption (currently not possible via CPD session on worker thread)
- Automate snapshot generation for larger eventlog sizes
- Share the performance reporting harness from `tests/perf`

## Commands

- `bun run dev` – run the test-app
- `bun run test` – run performance test

## Snapshot loading

Export state + eventlog SQLite snapshots from LiveStore Devtools and load them directly into the harness to avoid waiting for thousands of events to materialize:

1. Save snapshots from LiveStore devtools and save them as:

**10K events**

tests/perf-eventlog/tests/snapshots/state-10_000.db
tests/perf-eventlog/tests/snapshots/eventlog-10_000.db

**100K events**

tests/perf-eventlog/tests/snapshots/state-100_000.db
tests/perf-eventlog/tests/snapshots/eventlog-100_000.db

2. MANUAL: Click **Load snapshots** in the control panel and select the matching state and eventlog `.db` files. The harness restarts automatically once both imports finish.

3. AUTOMATED TESTS: Remove the `.skip` on the snapshot tests.

## Snapshot creation

Use LiveStore devtools to export state and eventlog databases and save them as:
