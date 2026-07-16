# Reactivity — Spec

This document specifies the reactivity graph, the live-query kinds, and the
dedup/caching layers (`packages/@livestore/livestore/src/{reactive.ts,
live-queries/,QueryCache.ts,SqliteDbWrapper.ts}`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: graph update guarantees, query-kind semantics, identity/dedup
rules, the caching substrate. Does not define: the Store surface and commit
path ([../spec.md](../spec.md)), state materialization
(`../../02-state/`).

## Graph Update Guarantees

`reactive.ts` implements a signals-based incremental graph
(Adapton-inspired, eager — lazy recomputation deliberately not
implemented):

- **Synchronous and eager:** a ref update refreshes the graph before
  `setRef(s)` returns; there is no scheduler or microtask deferral.
- **Atomic per commit:** one commit sets all written table refs in a single
  `setRefs` batch, producing exactly one refresh pass regardless of how many
  tables the events touched.
- **Glitch-free:** refresh proceeds in topological sort order (heights
  maintained eagerly as edges change), so a node never observes a mix of
  old and new inputs.
- **Equality cutoff:** each thunk compares against its previous result and
  stops propagation when equal. Db queries use an eagerly-built
  `Schema.toEquivalence`; supplying `map` disables the equivalence, so
  mapped queries always re-propagate (`db-query.ts:332-346`;
  LS.SYS.STORE.RX-R05).
- **Opt-out:** `commit({ skipRefresh: true }, …)` defers the refresh to a
  later manual refresh / `runDeferredEffects` pass; subscriber effects run
  through the adapter-provided `batchUpdates` wrapper.

## Query Kinds

| Kind | Constructor | Identity (`def.hash`) | Notes |
| --- | --- | --- | --- |
| Db query | `queryDb()` | `queryString + deps + extraDeps` | `SessionIdSymbol` serialized as the literal `'SessionIdSymbol'` so identity stays session-agnostic |
| Computed | `computed()` | `deps` if given, else `fn.toString()` | Referential result equality only (no schema equivalence) |
| Signal | `signal()` | `nanoid()` | Every call is unique — signals never dedup; `set` takes a plain value (functional update resolved by `store.setSignal`) |
| Client document | `table.get(id)` backing query | RowQuery label `${table}.get:${id}` | First read seeds the default row via `store.commit(table.set(...))` with `skipRefresh: true` to avoid a reactive loop during render |

Db queries are two thunks: `queryInput$` builds the SQL and tracks
dependencies (its equality compares query text + `deepEqual(bindValues)`;
the result schema is deliberately not compared), and `results$` executes and
decodes. Reactivity comes from `get(tableRef)` dependencies on the queried
tables — query-builder queries set a single table eagerly; raw-SQL/function
queries resolve tables lazily via `getTablesUsed`
(`db-query.ts:252,378-393`).

Contextual (function-form) db queries whose builder is not introspectable on
Hermes (Expo) must supply explicit `deps` or construction throws
(`db-query.ts:115`, `base-class.ts:104-125`; LS.SYS.STORE.RX-R04).

Query instances expose debug fields: `runs` (recomputation count; always `0`
for signals, whose `results$` is a ref, not a thunk), `executionTimes`,
`activeSubscriptions` (stack-info provenance), `isDestroyed`, monotonic
`id`.

Known limitation: `dependencyQueriesRef` is append-only across runs — a
dynamic query whose dependencies change keeps earlier dep instances
ref-counted until the query is destroyed (`base-class.ts:329` TODO).

## Identity and Dedup — Two Independent Layers

The current-layer distinction (LS.SYS.STORE.RX-R03; previously conflated in
this tree):

1. **Instance dedup** (`defRcMap`, `base-class.ts:345-373`): live-query
   instances are shared by `def.hash` with reference counting; `deref()` at
   zero destroys the instance. Signals opt out by construction (nanoid
   hash).
2. **SQL result cache** (`QueryCache.ts`): an LRU (200 entries) keyed on
   SQL text + bind values, invalidated per written table on
   `cachedExecute`; transaction-control statements are ignored. This caches
   *values*, not reactivity — a hot table with >200 distinct queries evicts
   silently (flagged as provisional in code comments).

## Caching Substrate (`SqliteDbWrapper`)

Wraps the session SQLite with: a prepared-statement cache (200,
finalize-on-evict), `getTablesUsed` via SQLite's `tables_used()` virtual
table (with a special case for plain `DELETE FROM x`, which `tables_used()`
mishandles), and the result cache above. Write tracking here only
invalidates cached values; the refresh that re-runs live queries is driven
separately by the store bumping `tableRefs`. `getTablesUsed` is the shared
primitive feeding both mechanisms.
