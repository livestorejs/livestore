# 0002 — Batch replay writes using existing eventlog pages

Status: accepted for the replay implementation (2026-09-06), supported by the
Cloudflare write-budget and common leader recovery regressions described below.

## Context

Full replay after a schema change repeatedly writes shared SQLite pages. The
Cloudflare adapter bills these writes. The regression fixture for
[#1555](https://github.com/livestorejs/livestore/issues/1555) measured 2,586 writes
for 250 events and 10,140 writes for 1,000 events before batching.

## Decision

Consume each eventlog page inside the shared `withSavepoint` helper. Default to
100 events per page and allow each client runtime to select any positive integer with
`createStore.params.stateRebuildBatchSize`. Keep materialization sequential and
retain per-event progress. Commit application rows, the state head and undo
metadata together. Keep hooks and the completion marker outside replay batches,
in their existing order.

Treat this as runtime tuning rather than schema identity: different clients of
the same store can have different resource limits, and changing the value does
not trigger a rebuild. Prioritize memory headroom over further write savings in
the default. Retaining 100 limits the batch's contribution; it is not evidence
that full boot fits a Cloudflare isolate.

## Alternatives

- One transaction for the whole eventlog would retain transaction state across
  an unbounded number of events.
- Rebuilding a second in-memory database would duplicate state and require a
  separate persistence/publication protocol.
- VFS buffering would broaden the change into persistence durability.

## Consequences

The current batch rolls back on failure or interruption. Earlier batches may
survive, but the completion protocol still requires a clean rebuild before reuse.
Batch size bounds event count, not bytes, materializer work, WASM capacity or
whole-isolate memory. Lower values use smaller read/savepoint batches but perform
more queries, savepoints and persistence writes. Higher values do the reverse.
The setting applies to future rebuilds only. No live-event transaction changes
or new transaction helper is needed.

## Evidence

`tests/integration/src/tests/adapter-cloudflare/adapter-cloudflare.test.ts`
passes budgets of 1,250 and 5,000 writes for the same 250/1,000-event fixtures.
The tests also verify replay order, hooks, unchanged eventlog/sync metadata and
zero-write completed-state reuse. The common leader regression in
`tests/package-common/src/leader-thread/recreate-db.test.ts` fails replay in the
first and second batches, checks rows/head/undo rollback, then verifies full retry.
The shared savepoint tests cover failure, defects, interruption and nesting.

Exploratory local measurements covered 100 to 1,000,000 events and larger payloads.
For one million small events, batch 100 reduced writes from 10,424,530 to 270,060.
Batch 1,000 reduces them further to 62,276. Separate memory profiles support
retaining 100 as a conservative internal default: for 1,000 events with an extra
16 KiB per title, batch 1,000 saves only another 1.6% of writes while increasing
the SQLite allocator's replay peak from 8.6 to 34.6 MiB. Small rows show a much
better tradeoff. Whole-boot memory also includes JavaScript, snapshots and WASM
capacity, so the SQLite peak does not imply the same increase in total memory.
Neither batch size is a universal optimum. The exploratory benchmark is not part
of the test suite; the unconditional write-budget regressions protect this change.

Several local batch-100 profiles already exceed Cloudflare's documented memory
ceiling when measuring used JavaScript heap plus backing storage across full boot.
The same workloads also exceed it with the original unbatched replay module;
the full-boot memory problem predates this change. Batch 100 adds little to the
measured SQLite allocator peak compared with original replay.
Free-plan compatibility with headroom is therefore not established by this PR.
The broader capacity investigation and production validation are tracked in
[#1612](https://github.com/livestorejs/livestore/issues/1612).
