# Leader syncState consumption & head-follow walkthrough

## Goal

Document how existing LiveStore components observe `SyncState.upstreamHead`, issue batched SQL over the leader eventlog, and resume streaming when the head advances. Focus is on high-volume eventlogs (more rows than a configured batch size) where the upstream head moves during the read.

## Where leader sync state is produced

- `LeaderSyncProcessor` materializes upstream payloads and writes them into the leader eventlog. After each merge it updates the shared `SubscriptionRef` so downstream observers see the new `SyncState`.

```760:766:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
        yield* SubscriptionRef.set(syncStateSref, mergeResult.newSyncState)
```

- The same processor reads the current head when preparing cursor info for backend pulls. That guarantees every pull request uses the latest upstream head known to the leader.

```773:777:packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
    const syncState = yield* syncStateSref
    const cursorInfo = yield* Eventlog.getSyncBackendCursorInfo({ remoteHead: syncState.upstreamHead.global })
```

- Worker adapters forward the same `syncState.changes` stream to tooling so anyone observing the leader sees head movements as they happen.

```236:241:packages/@livestore/adapter-web/src/web-worker/leader-worker/make-leader-worker.ts
    SyncStateStream: () =>
      Effect.gen(function* () {
        const workerCtx = yield* LeaderThreadCtx
        return workerCtx.syncProcessor.syncState.changes
      }).pipe(Stream.unwrapScoped),
```

## How client sessions observe leader head updates

- `ClientSessionSyncProcessor` exposes `syncState` as a `Subscribable`: `get` returns the in-memory snapshot, while `changes` replays all enqueue updates. Each queued entry reflects the `mergeResult.newSyncState` originating from the leader pull path.

```348:355:packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts
    syncState: Subscribable.make({
      get: Effect.gen(function* () { return syncStateRef.current }) ,
      changes: Stream.fromQueue(syncStateUpdateQueue),
    }),
```

- Example usages downstream:
  - Devtools surface leader `syncState.changes` via worker RPC for live inspection.

    ```239:240:packages/@livestore/common/src/leader-thread/leader-worker-devtools.ts
                yield* syncProcessor.syncState.changes.pipe(
    ```

  - Store devtools subscribe to the session processor’s `syncState.changes` to log head/pending transitions.

    ```274:288:packages/@livestore/livestore/src/store/devtools.ts
            store.syncProcessor.syncState.changes.pipe(
              Stream.tap((syncState) =>
                Effect.logDebug('[@livestore/devtools] session sync state updated', {
                  upstream: syncState.upstreamHead,
                  local: syncState.localHead,
                  pending: syncState.pending.length,
                }),
              ),
    ```

- Unlike the leader’s `SubscriptionRef` stream, the session’s queue-backed `changes` does not emit the current snapshot on subscription. Every consumer currently reads `syncState.get` before piping `changes` to seed the initial head.

- During boot, the client subscribes to the leader’s `events.pull` stream, feeding every payload through `SyncState.merge`. The resulting `newSyncState` is enqueued so observers (e.g. UI, stores) get notified about the latest `upstreamHead`.

```220:247:packages/@livestore/common/src/sync/ClientSessionSyncProcessor.ts
    yield* Stream.suspend(() =>
      clientSession.leaderThread.events.pull({ cursor: syncStateRef.current.upstreamHead }),
    ).pipe(
      Stream.tap(({ payload }) =>
        Effect.gen(function* () {
          const mergeResult = SyncState.merge({ syncState: syncStateRef.current, payload, ... })
          syncStateRef.current = mergeResult.newSyncState
          yield* syncStateUpdateQueue.offer(mergeResult.newSyncState)
        }),
      ),
```

- Tests cover the same pathway by simulating pulls and awaiting `syncState.changes` until the head reaches the expected value.

```170:175:tests/package-common/src/client-session/ClientSessionSyncProcessor.test.ts
      yield* store.syncProcessor.syncState.changes.pipe(
        Stream.filter((state) => state.pending.length === 0 && EventSequenceNumber.isEqual(state.localHead, state.upstreamHead)),
        Stream.take(1),
      )
```

## Batched SQL over the leader eventlog

- All historical pulls use `Eventlog.streamEventsFromEventlog`. It issues repeated `SELECT` statements with `LIMIT {batchSize} OFFSET {offset}`, optionally bounded by `until`.

```161:225:packages/@livestore/common/src/leader-thread/eventlog.ts
      while (hasMore) {
        const query = `SELECT * FROM ${EVENTLOG_META_TABLE} ${whereClause} ORDER BY seqNumGlobal ASC, seqNumClient ASC LIMIT ${batchSize} OFFSET ${offset}`
        const eventlogEvents = dbEventlog.select<EventlogMetaRow>(query, bindValues as any)

        if (eventlogEvents.length === 0) {
          hasMore = false
          break
        }

        for (const eventlogEvent of eventlogEvents) {
          const encodedEvent = LiveStoreEvent.EncodedWithMeta.make({ ... })
          emit.single(encodedEvent)
        }

        offset += batchSize
        hasMore = eventlogEvents.length === batchSize
      }
```

- The SELECT clause enforces `seqNumGlobal > since.global` and, when supplied, `seqNumGlobal <= until.global`. That makes the stream safe to call repeatedly with incrementing cursors: each invocation only returns the gap between the previous cursor and the new head.

## Large eventlog scenario (batchSize < total rows)

### 1. Initial head snapshot

1. `LeaderSyncProcessor` exposes its current `SyncState` through `syncStateSref`.
2. The client session asks `leaderThread.syncState.get` and receives the latest `upstreamHead`.
3. The consumer (e.g. store) kicks off a fetch:
   - `since` = last durable cursor (often `EventSequenceNumber.ROOT` on first run).
   - `until` = snapshot of `upstreamHead`.
   - `batchSize` from configuration (default `DEFAULT_PARAMS.eventQueryBatchSize`).

### 2. Batched query execution

1. `streamEventsFromEventlog` builds the `WHERE` clause (`seqNumGlobal > since.global` and `<= until.global`).
2. The first query pulls `LIMIT batchSize OFFSET 0` rows.
3. After emitting the batch, the function increments `offset` and loops while the previous page was full.
4. Because the eventlog might contain far more rows than `batchSize`, multiple SQL round-trips occur until either:
   - The next page returns fewer than `batchSize` rows (meaning the cursor reached `until`), or
   - `hasMore` becomes false when no rows remain.

### 3. Head advances during consumption

1. Upstream pushes arrive, the leader merges them, materializes state, and calls `SubscriptionRef.set(syncStateSref, newSyncState)`.
2. The client session’s pull fiber receives the payload, calls `SyncState.merge`, updates `syncStateRef.current`, and enqueues the new state into `syncStateUpdateQueue`.
3. Observers consuming `syncState.changes` see a fresh `upstreamHead`.

### 4. Incremental follow-up query

1. The consumer records the final event sequence from the previous batch run (typically the emitted `until`).
2. When `syncState.changes` emits a higher `upstreamHead`, the consumer launches a new `streamEventsFromEventlog` call with:
   - `since` = cursor from step 3 (the last processed head).
   - `until` = the new `upstreamHead` snapshot.
3. Because `streamEventsFromEventlog` enforces `seqNumGlobal > since.global`, no previously fetched events are replayed; only the gap is returned.
4. The loop in `streamEventsFromEventlog` again handles large gaps by paging through the new rows until the offset consumes the full delta.

### 5. Repeat as head keeps moving

- Each head increment yields a fast, bounded query against the leader eventlog. Even if the upstream runs ahead by millions of events, consumers process them in `batchSize` chunks without re-reading prior rows.

## Observations & alignment with current store work

- The store-level stream we are designing mirrors the same pattern: read once up to the current head, then use `syncState.changes` to trigger incremental replays.
- Aligning with existing implementations ensures we reuse proven behaviors:
  - Rely on `SyncState.merge` to publish head changes.
  - Use `since`/`until` filters to bound SQL queries and avoid duplication.
  - Maintain the “last processed head” locally to seed the next fetch.
- Any future client-session streaming feature can adopt the identical loop, swapping `leaderThread.events.stream` for the session-specific source while still anchoring on `syncState` updates.


