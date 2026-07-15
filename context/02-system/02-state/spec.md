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
- In dev, materializer results are hashed and compared across
  materialization sites (`MaterializerHashMismatchError`) to detect
  non-determinism.
- Coverage is total at the type level: the `materializers()` builder
  requires a handler per non-derived event and excludes derived events
  (LS.SYS.STATE-R04).

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
