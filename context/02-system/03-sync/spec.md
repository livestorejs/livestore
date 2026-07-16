# Sync — Spec

This document specifies the sync boundary: topology, the provider
contract, and the shared error taxonomy. It builds on
[requirements.md](./requirements.md). Merge semantics live in
[01-syncstate](./01-syncstate/spec.md), processor mechanics in
[02-processors](./02-processors/spec.md).

## Status

Draft.

## Topology

```
 client session ──(local-push)──▶ leader ──(push, provider-chunked)──▶ backend
       ▲                            │ ▲                                  │
       └──(advance/rebase)──────────┘ └──(pull stream / poll)───────────┘

 SyncState per boundary:   pending events   upstreamHead ≤ localHead
```

The backend arbitrates: it accepts a push iff the batch's first event
chains onto its current head, else it answers `ServerAheadError`
(LS.SYS.SYNC-R01). Clients assign sequence numbers; the backend never
renumbers.

## Provider Contract

`sync/sync-backend.ts` (LS.SYS.SYNC-R02). Naming note: despite its name,
the `SyncBackend` type is the *client-side provider interface* — the
ontology's "Sync provider" package surface, not the ontology's "Sync
backend" (the central server). A code TODO renames it to
`SyncProviderClient`:

```ts
SyncBackend = {
  connect: Effect<void, IsOfflineError | UnknownError>
  pull: (cursor, { live? }) => Stream<{ batch, pageInfo }>
  push: (batch: Global.Encoded[]) => Effect<void, ...>  // ascending
  ping: Effect<void, ...>
  isConnected: SubscriptionRef<boolean>
  metadata: { name, description, ... }
  supports: { pullPageInfoKnown, pullLive }
}
```

- **Cursor:** global sequence number plus provider-opaque metadata; the
  engine persists and replays the metadata (`syncMetadataJson`) without
  interpreting it.
- **Pagination:** pull responses carry
  `pageInfo ∈ { NoMore | MoreKnown(remaining) | MoreUnknown }`; providers
  declare `pullPageInfoKnown`.
- **Liveness:** providers that cannot stream (`pullLive: false`) are
  polled.
- **Chunking (LS.SYS.SYNC-R04):** bounds live at the provider transport
  boundary, not the leader — the Cloudflare transports cap 100 events per
  message and 900 kB per frame (`sync-cf/src/common/constants.ts`);
  `transport-chunking.ts` splits oversized payloads
  (`OversizeChunkItemError` when a single item exceeds the cap). The
  leader's own batch sizes are smaller
  ([02-processors](./02-processors/spec.md)).

## Error Taxonomy

(LS.SYS.SYNC-R03)

| Family | Members | Recovery |
| --- | --- | --- |
| `RejectedPushError` (leader push validation) | `NonMonotonicBatchError`, `StaleRebaseGenerationError`, `LeaderAheadError` | rebase and retry |
| Backend | `IsOfflineError`, `BackendIdMismatchError`, `ServerAheadError` | wait/reconnect; `ServerAheadError` yields to the pull-driven rebase ([02-processors](./02-processors/spec.md)) |
| Transport | `OversizeChunkItemError` | surface (payload cannot be chunked) |
| Defects | `UnknownError` | surface, don't retry |

## Next-Gen Sync

**Maturity: experimental** (`sync/next/`): history DAG
(`history-dag.ts`), fact-based rebase (`rebase-events.ts`, consuming
`01-event-model` facts), and event compaction (`compact-events.ts`).
Would allow commutative events on independent fact branches to skip
rebasing and enable log compaction. Carries a parallel rebase/compaction
stack duplicating core concepts; not part of the shipping contract
(LS.SYS-R06).

## Realizations

- [03-cf](./03-cf/spec.md) — Cloudflare (in-repo reference realization).
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
