# 0001 — Require explicit rebuild completion before reusing state

Status: accepted for the recovery implementation (2026-09-06).

## Context

[#1605](https://github.com/livestorejs/livestore/issues/1605) demonstrates that
system tables can survive a failed rematerialization. Their existence therefore
cannot establish that the database is ready. A state head at the eventlog tip is
also insufficient when a post-migration hook has not finished.

## Decision

Add a fingerprinted state system table whose singleton row is inserted only after
replay and all migration hooks succeed. Boot without that row replaces derived
state with an empty SQLite database before rebuilding. Use the existing backup/
import abstraction, not adapter deletion finalizers or a list of tables to drop.
The eventlog and its sync metadata are not reset.
Browser fast-path snapshot loading uses the same completion predicate and falls
back to the leader snapshot on incomplete state, before queries can observe it.

## Alternatives

- Failure cleanup alone cannot handle runtime termination without finalizers.
- Continuing replay from a partial head cannot account for partially executed
  materializers or hook work.
- Dropping only declared tables can retain hook-created objects and stale data.
- Trusting old databases without a marker could silently accept partial state.

## Consequences

- The first upgrade from a pre-marker version rebuilds derived state once.
  Cloudflare deployments incur the associated replay duration and row writes.
- Successful later boots read the marker but do not rewrite it.
- Hook side effects outside the state database must tolerate retries.
- This is not a corruption-repair mechanism or a new storage-durability guarantee.
  Future buffered persistence needs its own crash-safe flush/publication analysis.
- No SQL batching, VFS buffering or changes to the asynchronous persistence/sync
  model are part of this fix.

## Evidence

The real Cloudflare adapter regression first failed against unchanged production
code: five committed events, failure at event three, then a successful boot with
only two rows. The fix is exercised by repeated replay failure, hook failure,
uncatchable DO reset during a post hook, empty eventlog and completed-state reuse.
The tests also compare persisted eventlog and sync metadata before/after retry.
The shared WASM regression holds an async post hook open and checks that no
completion row appears before it finishes. Shared leader boot regressions reopen
real SQLite files after init/pre/post-hook failure, mid-replay failure and fiber
interruption. They check that hook-created objects and partial rows are discarded,
all five pending events survive, and completed state is reused without replay.
A browser regression reads a real OPFS AccessHandlePoolVFS file and verifies that
missing/empty completion metadata is rejected while a completed snapshot is loaded.
It also verifies immediate cleanup of rejected snapshots and scoped cleanup of
accepted snapshots.
