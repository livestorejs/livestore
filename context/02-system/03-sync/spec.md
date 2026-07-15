# Sync — Spec

This document specifies sync semantics and the provider contract. It builds
on [requirements.md](./requirements.md).

## Status

Draft.

## Topology

```
 client session ──(local-push)──▶ leader ──(push batch ≤100)──▶ backend
       ▲                            │ ▲                            │
       └──(advance/rebase)──────────┘ └──(pull stream, live)──────┘

 SyncState per boundary:   pending events   upstreamHead ≤ localHead
```

## Sync-State Machine

`sync/syncstate.ts` (shared by `ClientSessionSyncProcessor` and
`LeaderSyncProcessor`, LS.SYS.SYNC-R05):

```ts
SyncState = { pending: Event[], upstreamHead: SeqNum, localHead: SeqNum }
Payload   = local-push | upstream-advance | upstream-rebase
merge(state, payload) → advance | rebase | reject | unexpected
```

- `upstream-advance` confirms and/or appends upstream events; pending
  events that conflict are rebased.
- `upstream-rebase` rolls back to a given event and re-applies
  (rollbackEvents + newEvents), propagating an upstream rebase downstream.
- Invariants per LS.SYS.SYNC-R03; the merge function is pure and covered by
  `syncstate.test.ts` with the `e{n}` notation.

Rebase (LS.SYS.SYNC-R04): pending `e3'` re-parented after pulled `e3`
becomes `e4r1` — state rollback uses session changesets
(`02-state/01-sqlite/`), then re-materialization.

## Provider Contract

`sync/sync-backend.ts` (LS.SYS.SYNC-R06). Naming note: despite its name,
the `SyncBackend` type is the *client-side provider interface* — the
ontology's "Sync provider" package surface, not the ontology's "Sync
backend" (the central server). A code TODO renames it to
`SyncProviderClient`:

```ts
SyncBackend = {
  connect: Effect<void, IsOfflineError | UnknownError>
  pull: (cursor, { live? }) => Stream<{ batch, pageInfo }>
  push: (batch: Global.Encoded[]) => Effect<void, ...>  // 1–100, ascending
  ping: Effect<void, ...>
  isConnected: SubscriptionRef<boolean>
  metadata: { name, description, ... }
  supports: { pullPageInfoKnown, pullLive }
}
```

Providers that cannot stream (`pullLive: false`) are polled. Transport
chunking (`transport-chunking.ts`) splits oversized payloads
(LS.SYS.SYNC-R08).

## Error Taxonomy

(LS.SYS.SYNC-R07)

| Family | Members | Recovery |
| --- | --- | --- |
| `RejectedPushError` (leader push validation) | `NonMonotonicBatchError`, `StaleRebaseGenerationError`, `LeaderAheadError` | rebase and retry |
| Backend | `IsOfflineError`, `BackendIdMismatchError`, `ServerAheadError` | wait/reconnect; rebase and retry for `ServerAheadError` |
| Defects | `UnknownError` | surface, don't retry |

## Next-Gen Sync

**Maturity: experimental** (`sync/next/`): history DAG
(`history-dag.ts`), fact-based rebase (`rebase-events.ts`, consuming
`01-event-model` facts), and event compaction (`compact-events.ts`).
Would allow commutative events on independent fact branches to skip
rebasing and enable log compaction. Not part of the shipping contract
(LS.SYS-R06).

## Realizations

- [01-cf](./01-cf/spec.md) — Cloudflare (in-repo reference realization).
- `sync-electric`, `sync-s2` — contrib-owned; stub shape pending root
  LS-DQ2.
- `mock-sync-backend.ts` — in-memory realization for tests
  (`09-verification/`).

## Open Design Questions

- **LS.SYS.SYNC-DQ1 Commit confirmation surface:** Owned by `05-store/`
  (LS.SYS.STORE-DQ1); sync's role is providing the leader/backend
  confirmation stages.
- **LS.SYS.SYNC-DQ2 next/ graduation:** What evidence graduates the history
  DAG + compaction design (couples with LS.SYS.EVT-DQ2 facts and root
  LS-DQ1 command replay).
