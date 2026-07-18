# Syncstate — Spec

This document specifies the pure merge core in
`packages/@livestore/common/src/sync/syncstate.ts`. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: the `SyncState` shape, payload kinds, merge outcomes, invariants,
rebase-generation semantics, and client-only event handling. Does not
define: who drives merges and applies their results
([../02-processors/](../02-processors/spec.md)), state rollback mechanics
(`../../02-state/01-sqlite/`), or the provider wire
([../spec.md](../spec.md)).

## SyncState

```ts
SyncState = {
  pending:      EncodedWithMeta[]  // local events not yet upstream-confirmed
  upstreamHead: SeqNum.Composite   // what this node expects upstream's local head to be
  localHead:    SeqNum.Composite   // = pending.at(-1)?.seqNum when pending non-empty
}
```

(`syncstate.ts:44-56`.) Heads are composite sequence numbers
(`{global, client, rebaseGeneration}`, see `../../01-event-model/`).

Total-order rebase as the default conflict model is a founding decision —
see [.decisions/0001](./.decisions/0001-total-order-rebase-default.md).

## Payloads and Outcomes

```
merge(state, payload, { isEqualEvent, isClientOnlyEvent, ignoreClientOnlyEvents })
  payload: local-push { newEvents }
         | upstream-advance { newEvents }
         | upstream-rebase { rollbackEvents, newEvents }
  →  advance { newSyncState, newEvents, confirmedEvents }
   | rebase  { newSyncState, newEvents, rollbackEvents }
   | reject  { expectedMinimumId }
```

(`syncstate.ts:61-78, 109-162, 187-438`.) There is no returned fourth
outcome: invariant violations die as defects via `Effect.dieDebugger`
(`syncstate.ts:274, 285, 525, 539-560, 580-606`) — they indicate a broken
caller, not a mergeable condition. Every non-reject result is re-validated
before it is returned (`validateMergeResult`, `syncstate.ts:568-613`).

Branch semantics:

- **local-push** (`:379-433`): first new event must be strictly greater
  than `localHead`, else `reject` with `expectedMinimumId` (the next valid
  client-only pair). Accepted events append to `pending` (the leader drops
  client-only events from `pending` when `ignoreClientOnlyEvents` is set).
  Mirrors what the sync backend runs on push (comment `:378`).
- **upstream-advance** (`:251-375`): empty payload is a no-op advance.
  Otherwise `findDivergencePoint` (`:444-481`) compares pending against
  incoming via `isEqualEvent`. No divergence → `advance`, splitting pending
  into `confirmedEvents` (matched prefix) and remaining pending. Divergence
  → `rebase` of the divergent suffix.
- **upstream-rebase** (`:222-248`): rolls back `payload.rollbackEvents`
  plus all local pending, then re-parents pending onto the new upstream
  head; propagates an upstream-initiated rebase downstream.

## Invariants

`validateSyncState` (`:532-566`) and `validateMergeResult` (`:568-613`)
enforce, dying on violation:

1. Pending is strictly ascending by sequence number.
2. When the global part increases between adjacent pending events, the
   successor's client part is 0; otherwise `parentSeqNum` chains exactly
   to the predecessor (continuous chain).
3. `upstreamHead ≤ localHead`.
4. Neither head ever moves backwards across a merge.

## Rebase Generations

`rebaseEvents` (`:483-505`) re-parents each event onto the new base,
setting `rebaseGeneration = base.rebaseGeneration + 1`. Rebasing preserves
sync scope: client-only events keep advancing the client component
(`eN.k`), synced events the global component (comment `:495-496`). The
generation lets processors detect and drop stale in-flight pushes after a
rebase (see [../02-processors/](../02-processors/spec.md)).

## Client-Only Event Handling

`EncodedWithMeta` does not carry the event definition's `clientOnly` flag,
so `merge` takes the schema-aware predicate `isClientOnlyEvent`
(`syncstate.ts:196-202`). `ignoreClientOnlyEvents: true` (leader side)
filters client-only events from accepted local pushes (`:411-414`) and
from divergence comparison (`:457-464`) — the leader's pending list and
upstream comparisons deal in synced events only, while sessions keep
client-only events pending toward their leader.

## Purity Caveat

`merge` is deterministic given (state, payload) and the two injected
predicates `isEqualEvent`/`isClientOnlyEvent` (`syncstate.ts:187-215`) —
"pure" holds only modulo these; callers must supply pure predicates.
`isEqualEvent` compares logical encoded identity and must ignore
transport/runtime metadata (comment `:203-208`).

## Known Non-Features

- `_flattenMergeResults` (`:507-514`) — coalescing queued merge results to
  avoid push-threshing is an acknowledged TODO, not implemented.
