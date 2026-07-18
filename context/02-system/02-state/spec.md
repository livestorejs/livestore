# State (Read Model) — Spec

This document specifies the realization-agnostic state-derivation contract.
It builds on [requirements.md](./requirements.md).

## Status

Draft.

## Derivation Pipeline

```
eventlog ──▶ materializer(event, ctx) ──▶ mutations ──▶ state ──▶ queries
   ▲              │ ctx.query (read current state)         │
   └── rebuild ◀──┴──── rollback (session changesets) ◀────┘
```

## Materializer Contract

```ts
// packages/@livestore/common/src/schema/EventDef/materializer.ts
type Materializer<TEventDef> = (
  args: TEventDef['schema']['Type'],       // decoded payload
  context: {
    query: MaterializerContextQuery        // read current state
    event: LiveStoreEvent.Client.Decoded   // full metadata
    eventDef: TEventDef
    currentFacts: EventDefFacts            // experimental
  },
) => SingleOrReadonlyArray<MaterializerResult>
```

- Materializers may read current state via `context.query`
  (LS.SYS.STATE-R02 determinism therefore means: function of event + state).
- `context.currentFacts` is a constant empty `Map` today — facts are not
  wired into materialization (see the experimental marker in
  `../01-event-model/spec.md`).
- In dev, materializer results are hashed; the leader compares an incoming
  event's session hash against its own (`materialize-event.ts:78-84`) —
  only when a session hash is present — raising
  `MaterializerHashMismatchError` on divergence.
- Coverage is total at the type level: the `materializers()` builder
  requires a handler per non-derived event and excludes derived events
  (LS.SYS.STATE-R04).

### Execution boundaries

Leader-side batch materialization writes the state DB and the eventlog DB in
two *coordinated* transactions — begun and committed in lockstep inside one
uninterruptible Effect with a joint rollback finalizer
(`LeaderSyncProcessor.ts:849-886`). This protects against errors and fiber
interruption, but is **not** atomic across the two databases under process
crash; divergence heals via rebuild on next boot (state is derived). Batch
mechanics live in `../03-sync/02-processors/`.

### Error classification

The classification is contract (LS.SYS.STATE-R07):

| Failure | Kind |
| --- | --- |
| `MaterializeError` (materializer threw / bad SQL) | recoverable tagged error |
| `MaterializerHashMismatchError` (dev determinism check) | recoverable tagged error |
| Unknown event definition on **write** (`eventlog.ts:228`) | defect (`shouldNeverHappen`) |
| Missing event definition during materialization (`materialize-event.ts:133`) | defect (`shouldNeverHappen`) |

Unknown events on **read** are tolerated (`../01-event-model/spec.md`).

## Realization Contract

A realization supplies (LS.SYS.STATE-R05):

| Obligation | Meaning |
| --- | --- |
| Mutation format | What a `MaterializerResult` is (e.g. SQL statement) |
| Query surface | Typed read-only queries for app + live queries |
| Rebuild | Recreate state from the full eventlog |
| Rollback | Undo recent materializations for rebase (e.g. SQLite session changesets) |
| Schema drift handling | Detect definition changes, trigger rebuild |

Realizations: [01-sqlite](./01-sqlite/spec.md) (primary, shipping).
Additional realizations are a roadmap item (root `roadmap.md`).
