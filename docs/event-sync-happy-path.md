[!] WRITTEN BY CLAUDE FOR RESEARCH PURPOSE

# Event Lifecycle: Client Commit to Backend Confirmation

This walkthrough follows a single event on the happy path (no conflicts, no rebases) from the moment a client commits it until the backend confirms it. At each hop—client session, leader thread, backend—we show how state changes are recorded in the relevant SQLite tables and point to the code that performs each transition.

> Scope: normal operation with uninterrupted connectivity. Footnote markers reference follow-up topics (rebasing, retries, etc.).

## Actors and Artifacts

- **Client session** (running in the app process): holds the local SQLite state DB plus an in-memory `SyncState` of pending events.
- **Leader thread** (background worker): persists events into its eventlog database and coordinates pushes/pulls with the backend.
- **Sync backend**: authoritative store that acknowledges events by advancing its global head.

Key data structures:

- `LiveStoreEvent.EncodedWithMeta`: the serialized event with sequence numbers, client/session ids, and sync metadata.
- `EventSequenceNumber`: tuple `{ global, client, rebaseGeneration }` ensuring total ordering.
- Tables referenced below:
  - Client state DB: `__livestore_session_changeset`
  - Leader eventlog DB: `eventlog`, `__livestore_sync_status`

## Step-by-Step Flow

### 1. Client Commit (pending)

Code path:

```621:678:packages/@livestore/livestore/src/store/store.ts
      const { writeTables } = yield* materializeEventsTx
```

`Store.commit` forwards events to `ClientSessionSyncProcessor.push`, which assigns sequence numbers and merges them into the client `SyncState` via the `local-push` branch.

```105:180:packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts
    const mergeResult = SyncState.merge({
      syncState: syncStateRef.current,
      payload: { _tag: 'local-push', newEvents: encodedEventDefs },
      isClientEvent,
      isEqualEvent: LiveStoreEvent.isEqualEncoded,
    })
```

Outcome:

- `syncState.pending` now includes the new event.
- Local SQLite state is updated immediately; a changeset blob is captured for potential rollback.

Client DB snapshot (`__livestore_session_changeset`):

| seqNumGlobal | seqNumClient | changeset |
|--------------|--------------|-----------|
| `e42`        | `0`          | binary    |

(`rebaseGeneration` defaults to 0; table also stores `debug` metadata.)

### 2. Client → Leader Push (leader pending)

The push queue flushes to the leader thread:

```489:538:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
      yield* connectedClientSessionPullQueues.offer({
        payload: SyncState.PayloadUpstreamAdvance.make({ newEvents: mergeResult.newEvents }),
        leaderHead: mergeResult.newSyncState.localHead,
      })
      yield* BucketQueue.offerAll(syncBackendPushQueue, filteredBatch)
```

During `materializeEventsBatch` the leader persists the event:

```550:580:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
    for (let i = 0; i < batchItems.length; i++) {
      const { sessionChangeset, hash } = yield* materializeEvent(batchItems[i]!)
      batchItems[i]!.meta.sessionChangeset = sessionChangeset
      batchItems[i]!.meta.materializerHashLeader = hash
    }
    dbEventlog.execute('COMMIT', undefined)
```

`insertIntoEventlog` writes a row into the leader eventlog database:

```261:308:packages/@livestore/common/src/leader-thread/eventlog.ts
    yield* execSql(
      dbEventlog,
      ...insertRow({
        tableName: EVENTLOG_META_TABLE,
        values: {
          seqNumGlobal: eventEncoded.seqNum.global,
          seqNumClient: eventEncoded.seqNum.client,
          parentSeqNumGlobal: eventEncoded.parentSeqNum.global,
          name: eventEncoded.name,
          argsJson: eventEncoded.args ?? {},
          clientId,
          sessionId,
          syncMetadataJson: eventEncoded.meta.syncMetadata,
        },
      }),
    )
```

Leader `eventlog` snapshot:

| seqNumGlobal | seqNumClient | parentSeqNum | name        | clientId | sessionId | syncMetadata |
|--------------|--------------|--------------|-------------|----------|-----------|--------------|
| `e42`        | `0`          | `e41`        | `todoCreated` | c-123    | s-456     | `null`       |

### 3. Leader → Client Confirmation (pending cleared)

The leader emits an `upstream-advance` payload back to subscribed clients. On receipt, the client merges via the same `SyncState.merge` function:

```206:374:packages/@livestore/common/src/sync/syncstate.ts
        return validateMergeResult(
          MergeResultAdvance.make({
            newSyncState: new SyncState({
              pending: pendingRemaining,
              upstreamHead: newUpstreamHead,
              localHead: pendingRemaining.at(-1)?.seqNum ?? EventSequenceNumber.max(syncState.localHead, newUpstreamHead),
            }),
            confirmedEvents: pendingMatching,
```

Because the leader sent back the same event, the client removes it from `pending` and marks it confirmed.

Client state after confirmation:

- `syncState.pending` no longer contains the event.
- `syncState.upstreamHead` and `localHead` both equal `e42`.
- The changeset row stays until the backend head moves past `e42` (cleanup happens later).

### 4. Leader → Backend Push (backend pending)

The leader enqueues non-client-only events for backend pushing (see the filtered batch above). The background push effect sends them to the backend service with retry semantics:

```776:855:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
      const queueItems = yield* BucketQueue.takeBetween(syncBackendPushQueue, 1, backendPushBatchSize)
      const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)
```

Backend storage (conceptual) now holds the event. The leader still treats the event as pending with respect to backend confirmation until the backend echoes it during a pull.

### 5. Backend Pull → Confirmation (leader & backend head update)

When the backend responds with the event in a pull page, the leader merges it with `ignoreClientEvents: true` to avoid duplicating client-only data:

```640:716:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
        const mergeResult = SyncState.merge({
          syncState,
          payload: SyncState.PayloadUpstreamAdvance.make({ newEvents }),
          isClientEvent,
          isEqualEvent: LiveStoreEvent.isEqualEncoded,
          ignoreClientEvents: true,
        })
        const newBackendHead = newEvents.at(-1)!.seqNum
        Eventlog.updateBackendHead(dbEventlog, newBackendHead)
```

`updateBackendHead` records the confirmed position:

```250:251:packages/@livestore/common/src/leader-thread/eventlog.ts
export const updateBackendHead = (dbEventlog: SqliteDb, head: EventSequenceNumber.EventSequenceNumber) =>
  dbEventlog.execute(sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head.global}`)
```

Leader `__livestore_sync_status` snapshot:

| head |
|------|
| `42` |

Once the backend head advances, `trimChangesetRows` prunes obsolete client changesets:

```857:861:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
const trimChangesetRows = (db: SqliteDb, newHead: EventSequenceNumber.EventSequenceNumber) => {
  db.execute(sql`DELETE FROM ${SystemTables.SESSION_CHANGESET_META_TABLE} WHERE seqNumGlobal < ${newHead.global}`)
}
```

At this point the event is fully confirmed across client, leader, and backend.

## Summary Table

| Stage | Client `SyncState` | Client `__livestore_session_changeset` | Leader `eventlog` | Leader `__livestore_sync_status` |
|-------|--------------------|----------------------------------------|-------------------|----------------------------------|
| Commit | pending includes event; heads still previous | row inserted (seq `e42`) | — | head unchanged |
| Leader push | pending unchanged | unchanged | row inserted | head unchanged |
| Leader advance | pending cleared; heads → `e42` | still present | row exists | head unchanged |
| Backend push | same as above | same | row exists | head unchanged |
| Backend confirmation | same | rows `< e42` trimmed afterwards | row exists with sync metadata updated | head = `42` |

## Footnotes / Further Reading

1. **Rebases & conflicts**: `SyncState.merge` handles divergence (`upstream-rebase`) and rollback paths when the backend rejects or reorders events. See `syncstate.test.ts` for scenarios.
2. **Client-only events**: Events flagged `clientOnly` never leave the client; they remain in pending and are filtered out before backend push.
3. **Retries & offline resilience**: Leader backend pushing uses exponential backoff and reacts to server-ahead errors by waiting for new pull chunks.
4. **Materializer hashes**: Both client and leader capture hashes (`materializerHashSession`, `materializerHashLeader`) to detect mismatches when events round-trip.


