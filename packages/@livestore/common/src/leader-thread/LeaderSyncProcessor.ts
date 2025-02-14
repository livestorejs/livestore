import { isNotUndefined, shouldNeverHappen, TRACE_VERBOSE } from '@livestore/utils'
import type { HttpClient, Scope, Tracer } from '@livestore/utils/effect'
import {
  BucketQueue,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  Option,
  OtelTracer,
  ReadonlyArray,
  Schema,
  Stream,
  Subscribable,
  SubscriptionRef,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'

import type { SqliteDb } from '../adapter-types.js'
import { UnexpectedError } from '../adapter-types.js'
import type { LiveStoreSchema, SessionChangesetMetaRow } from '../schema/mod.js'
import {
  EventId,
  MUTATION_LOG_META_TABLE,
  MutationEvent,
  mutationLogMetaTable,
  SESSION_CHANGESET_META_TABLE,
} from '../schema/mod.js'
import { updateRows } from '../sql-queries/index.js'
import { InvalidPushError } from '../sync/sync.js'
import * as SyncState from '../sync/syncstate.js'
import { sql } from '../util.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import { getBackendHeadFromDb, getLocalHeadFromDb, getMutationEventsSince, updateBackendHead } from './mutationlog.js'
import type { InitialBlockingSyncContext, InitialSyncInfo, LeaderSyncProcessor } from './types.js'
import { LeaderThreadCtx } from './types.js'

type PushQueueItem = [
  mutationEvent: MutationEvent.EncodedWithMeta,
  deferred: Deferred.Deferred<void, InvalidPushError> | undefined,
]

/**
 * The LeaderSyncProcessor manages synchronization of mutations between
 * the local state and the sync backend, ensuring efficient and orderly processing.
 *
 * In the LeaderSyncProcessor, pulling always has precedence over pushing.
 *
 * Responsibilities:
 * - Queueing incoming local mutations in a localPushMailbox.
 * - Broadcasting mutations to client sessions via pull queues.
 * - Pushing mutations to the sync backend.
 *
 * Notes:
 *
 * local push processing:
 * - localPushMailbox:
 *   - Maintains events in ascending order.
 *   - Uses `Deferred` objects to resolve/reject events based on application success.
 * - Processes events from the mailbox, applying mutations in batches.
 * - Controlled by a `Latch` to manage execution flow.
 * - The latch closes on pull receipt and re-opens post-pull completion.
 * - Processes up to `maxBatchSize` events per cycle.
 *
 */
export const makeLeaderSyncProcessor = ({
  schema,
  dbMissing,
  dbMutationLog,
  initialBlockingSyncContext,
}: {
  schema: LiveStoreSchema
  /** Only used to know whether we can safely query dbMutationLog during setup execution */
  dbMissing: boolean
  dbMutationLog: SqliteDb
  initialBlockingSyncContext: InitialBlockingSyncContext
}): Effect.Effect<LeaderSyncProcessor, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const syncBackendQueue = yield* BucketQueue.make<MutationEvent.EncodedWithMeta>()

    const syncStateSref = yield* SubscriptionRef.make<SyncState.SyncState | undefined>(undefined)

    const isLocalEvent = (mutationEventEncoded: MutationEvent.EncodedWithMeta) => {
      const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
      return mutationDef.options.localOnly
    }

    // This context depends on data from `boot`, we should find a better implementation to avoid this ref indirection.
    const ctxRef = {
      current: undefined as
        | undefined
        | {
            otelSpan: otel.Span | undefined
            span: Tracer.Span
            devtoolsPullLatch: Effect.Latch | undefined
            devtoolsPushLatch: Effect.Latch | undefined
          },
    }

    const localPushesQueue = yield* BucketQueue.make<PushQueueItem>()
    const localPushesLatch = yield* Effect.makeLatch(true)
    const pullLatch = yield* Effect.makeLatch(true)

    const push: LeaderSyncProcessor['push'] = (newEvents, options) =>
      Effect.gen(function* () {
        // TODO validate batch
        if (newEvents.length === 0) return

        if (ctxRef.current?.devtoolsPushLatch !== undefined) {
          yield* ctxRef.current.devtoolsPushLatch.await
        }

        const waitForProcessing = options?.waitForProcessing ?? false

        if (waitForProcessing) {
          const deferreds = yield* Effect.forEach(newEvents, () => Deferred.make<void, InvalidPushError>())

          const items = newEvents.map(
            (mutationEventEncoded, i) => [mutationEventEncoded, deferreds[i]] as PushQueueItem,
          )

          yield* BucketQueue.offerAll(localPushesQueue, items)

          yield* Effect.all(deferreds)
        } else {
          const items = newEvents.map((mutationEventEncoded) => [mutationEventEncoded, undefined] as PushQueueItem)
          yield* BucketQueue.offerAll(localPushesQueue, items)
        }
      }).pipe(
        Effect.withSpan('@livestore/common:leader-thread:syncing:local-push', {
          attributes: {
            batchSize: newEvents.length,
            batch: TRACE_VERBOSE ? newEvents : undefined,
          },
          links: ctxRef.current?.span ? [{ _tag: 'SpanLink', span: ctxRef.current.span, attributes: {} }] : undefined,
        }),
      )

    const pushPartial: LeaderSyncProcessor['pushPartial'] = (mutationEventEncoded_) =>
      Effect.gen(function* () {
        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const mutationDef =
          schema.mutations.get(mutationEventEncoded_.mutation) ??
          shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded_.mutation}`)

        const mutationEventEncoded = new MutationEvent.EncodedWithMeta({
          ...mutationEventEncoded_,
          ...EventId.nextPair(syncState.localHead, mutationDef.options.localOnly),
        })

        yield* push([mutationEventEncoded])
      }).pipe(Effect.catchTag('InvalidPushError', Effect.orDie))

    // Starts various background loops
    const boot: LeaderSyncProcessor['boot'] = ({ dbReady }) =>
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan.pipe(Effect.orDie)
        const otelSpan = yield* OtelTracer.currentOtelSpan.pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        const { devtools } = yield* LeaderThreadCtx

        ctxRef.current = {
          otelSpan,
          span,
          devtoolsPullLatch: devtools.enabled ? devtools.syncBackendPullLatch : undefined,
          devtoolsPushLatch: devtools.enabled ? devtools.syncBackendPushLatch : undefined,
        }

        const initialBackendHead = dbMissing ? EventId.ROOT.global : getBackendHeadFromDb(dbMutationLog)
        const initialLocalHead = dbMissing ? EventId.ROOT : getLocalHeadFromDb(dbMutationLog)

        if (initialBackendHead > initialLocalHead.global) {
          return shouldNeverHappen(
            `During boot the backend head (${initialBackendHead}) should never be greater than the local head (${initialLocalHead.global})`,
          )
        }

        const pendingMutationEvents = yield* getMutationEventsSince({
          global: initialBackendHead,
          local: EventId.localDefault,
        }).pipe(Effect.map(ReadonlyArray.map((_) => new MutationEvent.EncodedWithMeta(_))))

        const initialSyncState = new SyncState.SyncState({
          pending: pendingMutationEvents,
          // On the leader we don't need a rollback tail beyond `pending` items
          rollbackTail: [],
          upstreamHead: { global: initialBackendHead, local: EventId.localDefault },
          localHead: initialLocalHead,
        })

        /** State transitions need to happen atomically, so we use a Ref to track the state */
        yield* SubscriptionRef.set(syncStateSref, initialSyncState)

        // Rehydrate sync queue
        if (pendingMutationEvents.length > 0) {
          const filteredBatch = pendingMutationEvents
            // Don't sync localOnly mutations
            .filter((mutationEventEncoded) => {
              const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
              return mutationDef.options.localOnly === false
            })

          yield* BucketQueue.offerAll(syncBackendQueue, filteredBatch)
        }

        yield* backgroundApplyLocalPushes({
          localPushesLatch,
          localPushesQueue,
          pullLatch,
          syncStateSref,
          syncBackendQueue,
          schema,
          isLocalEvent,
          otelSpan,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        const backendPushingFiberHandle = yield* FiberHandle.make()

        yield* FiberHandle.run(
          backendPushingFiberHandle,
          backgroundBackendPushing({ dbReady, syncBackendQueue, otelSpan }).pipe(Effect.tapCauseLogPretty),
        )

        yield* backgroundBackendPulling({
          dbReady,
          initialBackendHead,
          isLocalEvent,
          restartBackendPushing: (filteredRebasedPending) =>
            Effect.gen(function* () {
              // Stop current pushing fiber
              yield* FiberHandle.clear(backendPushingFiberHandle)

              // Reset the sync queue
              yield* BucketQueue.clear(syncBackendQueue)
              yield* BucketQueue.offerAll(syncBackendQueue, filteredRebasedPending)

              // Restart pushing fiber
              yield* FiberHandle.run(
                backendPushingFiberHandle,
                backgroundBackendPushing({ dbReady, syncBackendQueue, otelSpan }).pipe(Effect.tapCauseLogPretty),
              )
            }),
          syncStateSref,
          localPushesLatch,
          pullLatch,
          otelSpan,
          initialBlockingSyncContext,
          devtoolsPullLatch: ctxRef.current?.devtoolsPullLatch,
        }).pipe(Effect.tapCauseLogPretty, Effect.forkScoped)

        return { initialLeaderHead: initialLocalHead }
      }).pipe(Effect.withSpanScoped('@livestore/common:leader-thread:syncing'))

    return {
      push,
      pushPartial,
      boot,
      syncState: Subscribable.make({
        get: Effect.gen(function* () {
          const syncState = yield* syncStateSref
          if (syncState === undefined) return shouldNeverHappen('Not initialized')
          return syncState
        }),
        changes: syncStateSref.changes.pipe(Stream.filter(isNotUndefined)),
      }),
    } satisfies LeaderSyncProcessor
  })

const backgroundApplyLocalPushes = ({
  localPushesLatch,
  localPushesQueue,
  pullLatch,
  syncStateSref,
  syncBackendQueue,
  schema,
  isLocalEvent,
  otelSpan,
}: {
  pullLatch: Effect.Latch
  localPushesLatch: Effect.Latch
  localPushesQueue: BucketQueue.BucketQueue<PushQueueItem>
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  syncBackendQueue: BucketQueue.BucketQueue<MutationEvent.EncodedWithMeta>
  schema: LiveStoreSchema
  isLocalEvent: (mutationEventEncoded: MutationEvent.EncodedWithMeta) => boolean
  otelSpan: otel.Span | undefined
}) =>
  Effect.gen(function* () {
    const { connectedClientSessionPullQueues } = yield* LeaderThreadCtx

    const applyMutationItems = yield* makeApplyMutationItems

    while (true) {
      // TODO make batch size configurable
      const batchItems = yield* BucketQueue.takeBetween(localPushesQueue, 1, 10)
      const [newEvents, deferreds] = ReadonlyArray.unzip(batchItems)

      // Wait for the backend pulling to finish
      yield* localPushesLatch.await

      // Prevent the backend pulling from starting until this local push is finished
      yield* pullLatch.close

      const syncState = yield* syncStateSref
      if (syncState === undefined) return shouldNeverHappen('Not initialized')

      const updateResult = SyncState.updateSyncState({
        syncState,
        payload: { _tag: 'local-push', newEvents },
        isLocalEvent,
        isEqualEvent: MutationEvent.isEqualEncoded,
      })

      if (updateResult._tag === 'rebase') {
        return shouldNeverHappen('The leader thread should never have to rebase due to a local push')
      } else if (updateResult._tag === 'reject') {
        otelSpan?.addEvent('local-push:reject', {
          batchSize: newEvents.length,
          updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
        })

        const providedId = newEvents.at(0)!.id
        const remainingEvents = yield* BucketQueue.takeAll(localPushesQueue)
        const allDeferreds = [...deferreds, ...remainingEvents.map(([_, deferred]) => deferred)].filter(isNotUndefined)
        yield* Effect.forEach(allDeferreds, (deferred) =>
          Deferred.fail(
            deferred,
            InvalidPushError.make({
              // TODO improve error handling so it differentiates between a push being rejected
              // because of itself or because of another push
              reason: {
                _tag: 'LeaderAhead',
                minimumExpectedId: updateResult.expectedMinimumId,
                providedId,
              },
            }),
          ),
        )

        // Allow the backend pulling to start
        yield* pullLatch.open

        // In this case we're skipping state update and down/upstream processing
        // We've cleared the local push queue and are now waiting for new local pushes / backend pulls
        continue
      }

      yield* SubscriptionRef.set(syncStateSref, updateResult.newSyncState)

      yield* connectedClientSessionPullQueues.offer({
        payload: { _tag: 'upstream-advance', newEvents: updateResult.newEvents },
        remaining: 0,
      })

      otelSpan?.addEvent('local-push', {
        batchSize: newEvents.length,
        updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
      })

      // Don't sync localOnly mutations
      const filteredBatch = updateResult.newEvents.filter((mutationEventEncoded) => {
        const mutationDef = schema.mutations.get(mutationEventEncoded.mutation)!
        return mutationDef.options.localOnly === false
      })

      yield* BucketQueue.offerAll(syncBackendQueue, filteredBatch)

      yield* applyMutationItems({ batchItems: newEvents, deferreds })

      // Allow the backend pulling to start
      yield* pullLatch.open
    }
  })

type ApplyMutationItems = (_: {
  batchItems: ReadonlyArray<MutationEvent.EncodedWithMeta>
  /** Indexes are aligned with `batchItems` */
  deferreds: ReadonlyArray<Deferred.Deferred<void, InvalidPushError> | undefined> | undefined
}) => Effect.Effect<void, UnexpectedError>

// TODO how to handle errors gracefully
const makeApplyMutationItems: Effect.Effect<ApplyMutationItems, UnexpectedError, LeaderThreadCtx | Scope.Scope> =
  Effect.gen(function* () {
    const leaderThreadCtx = yield* LeaderThreadCtx
    const { dbReadModel: db, dbMutationLog } = leaderThreadCtx

    const applyMutation = yield* makeApplyMutation

    return ({ batchItems, deferreds }) =>
      Effect.gen(function* () {
        db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
        dbMutationLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

        yield* Effect.addFinalizer((exit) =>
          Effect.gen(function* () {
            if (Exit.isSuccess(exit)) return

            // Rollback in case of an error
            db.execute('ROLLBACK', undefined)
            dbMutationLog.execute('ROLLBACK', undefined)
          }),
        )

        for (let i = 0; i < batchItems.length; i++) {
          yield* applyMutation(batchItems[i]!)

          if (deferreds?.[i] !== undefined) {
            yield* Deferred.succeed(deferreds[i]!, void 0)
          }
        }

        db.execute('COMMIT', undefined) // Commit the transaction
        dbMutationLog.execute('COMMIT', undefined) // Commit the transaction
      }).pipe(
        Effect.uninterruptible,
        Effect.scoped,
        Effect.withSpan('@livestore/common:leader-thread:syncing:applyMutationItems', {
          attributes: { count: batchItems.length },
        }),
        Effect.tapCauseLogPretty,
        UnexpectedError.mapToUnexpectedError,
      )
  })

const backgroundBackendPulling = ({
  dbReady,
  initialBackendHead,
  isLocalEvent,
  restartBackendPushing,
  otelSpan,
  syncStateSref,
  localPushesLatch,
  pullLatch,
  devtoolsPullLatch,
  initialBlockingSyncContext,
}: {
  dbReady: Deferred.Deferred<void>
  initialBackendHead: EventId.GlobalEventId
  isLocalEvent: (mutationEventEncoded: MutationEvent.EncodedWithMeta) => boolean
  restartBackendPushing: (
    filteredRebasedPending: ReadonlyArray<MutationEvent.EncodedWithMeta>,
  ) => Effect.Effect<void, UnexpectedError, LeaderThreadCtx | HttpClient.HttpClient>
  otelSpan: otel.Span | undefined
  syncStateSref: SubscriptionRef.SubscriptionRef<SyncState.SyncState | undefined>
  localPushesLatch: Effect.Latch
  pullLatch: Effect.Latch
  devtoolsPullLatch: Effect.Latch | undefined
  initialBlockingSyncContext: InitialBlockingSyncContext
}) =>
  Effect.gen(function* () {
    const {
      syncBackend,
      dbReadModel: db,
      dbMutationLog,
      connectedClientSessionPullQueues,
      schema,
    } = yield* LeaderThreadCtx

    if (syncBackend === undefined) return

    const cursorInfo = yield* getCursorInfo(initialBackendHead)

    const applyMutationItems = yield* makeApplyMutationItems

    const onNewPullChunk = (newEvents: MutationEvent.EncodedWithMeta[], remaining: number) =>
      Effect.gen(function* () {
        if (newEvents.length === 0) return

        if (devtoolsPullLatch !== undefined) {
          yield* devtoolsPullLatch.await
        }

        // Prevent more local pushes from being processed until this pull is finished
        yield* localPushesLatch.close

        // Wait for pending local pushes to finish
        yield* pullLatch.await

        const syncState = yield* syncStateSref
        if (syncState === undefined) return shouldNeverHappen('Not initialized')

        const trimRollbackUntil = newEvents.at(-1)!.id

        const updateResult = SyncState.updateSyncState({
          syncState,
          payload: { _tag: 'upstream-advance', newEvents, trimRollbackUntil },
          isLocalEvent,
          isEqualEvent: MutationEvent.isEqualEncoded,
          ignoreLocalEvents: true,
        })

        if (updateResult._tag === 'reject') {
          return shouldNeverHappen('The leader thread should never reject upstream advances')
        }

        const newBackendHead = newEvents.at(-1)!.id

        updateBackendHead(dbMutationLog, newBackendHead)

        if (updateResult._tag === 'rebase') {
          otelSpan?.addEvent('backend-pull:rebase', {
            newEventsCount: newEvents.length,
            newEvents: TRACE_VERBOSE ? JSON.stringify(newEvents) : undefined,
            rollbackCount: updateResult.eventsToRollback.length,
            updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
          })

          const filteredRebasedPending = updateResult.newSyncState.pending.filter((mutationEvent) => {
            const mutationDef = schema.mutations.get(mutationEvent.mutation)!
            return mutationDef.options.localOnly === false
          })
          yield* restartBackendPushing(filteredRebasedPending)

          if (updateResult.eventsToRollback.length > 0) {
            yield* rollback({ db, dbMutationLog, eventIdsToRollback: updateResult.eventsToRollback.map((_) => _.id) })
          }

          yield* connectedClientSessionPullQueues.offer({
            payload: {
              _tag: 'upstream-rebase',
              newEvents: updateResult.newEvents,
              rollbackUntil: updateResult.eventsToRollback.at(0)!.id,
              trimRollbackUntil,
            },
            remaining,
          })
        } else {
          otelSpan?.addEvent('backend-pull:advance', {
            newEventsCount: newEvents.length,
            updateResult: TRACE_VERBOSE ? JSON.stringify(updateResult) : undefined,
          })

          yield* connectedClientSessionPullQueues.offer({
            payload: { _tag: 'upstream-advance', newEvents: updateResult.newEvents, trimRollbackUntil },
            remaining,
          })
        }

        trimChangesetRows(db, newBackendHead)

        yield* applyMutationItems({ batchItems: updateResult.newEvents, deferreds: undefined })

        yield* SubscriptionRef.set(syncStateSref, updateResult.newSyncState)

        if (remaining === 0) {
          // Allow local pushes to be processed again
          yield* localPushesLatch.open
        }
      })

    yield* syncBackend.pull(cursorInfo).pipe(
      // TODO only take from queue while connected
      Stream.tap(({ batch, remaining }) =>
        Effect.gen(function* () {
          // yield* Effect.spanEvent('batch', {
          //   attributes: {
          //     batchSize: batch.length,
          //     batch: TRACE_VERBOSE ? batch : undefined,
          //   },
          // })

          // Wait for the db to be initially created
          yield* dbReady

          // NOTE we only want to take process mutations when the sync backend is connected
          // (e.g. needed for simulating being offline)
          // TODO remove when there's a better way to handle this in stream above
          yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

          yield* onNewPullChunk(
            batch.map((_) => MutationEvent.EncodedWithMeta.fromGlobal(_.mutationEventEncoded)),
            remaining,
          )

          yield* initialBlockingSyncContext.update({ processed: batch.length, remaining })
        }),
      ),
      Stream.runDrain,
      Effect.interruptible,
    )
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:syncing:backend-pulling'))

const rollback = ({
  db,
  dbMutationLog,
  eventIdsToRollback,
}: {
  db: SqliteDb
  dbMutationLog: SqliteDb
  eventIdsToRollback: EventId.EventId[]
}) =>
  Effect.gen(function* () {
    const rollbackEvents = db
      .select<SessionChangesetMetaRow>(
        sql`SELECT * FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
      )
      .map((_) => ({ id: { global: _.idGlobal, local: _.idLocal }, changeset: _.changeset, debug: _.debug }))
      .toSorted((a, b) => EventId.compare(a.id, b.id))

    // Apply changesets in reverse order
    for (let i = rollbackEvents.length - 1; i >= 0; i--) {
      const { changeset } = rollbackEvents[i]!
      if (changeset !== null) {
        db.makeChangeset(changeset).invert().apply()
      }
    }

    // Delete the changeset rows
    db.execute(
      sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
    )

    // Delete the mutation log rows
    dbMutationLog.execute(
      sql`DELETE FROM ${MUTATION_LOG_META_TABLE} WHERE (idGlobal, idLocal) IN (${eventIdsToRollback.map((id) => `(${id.global}, ${id.local})`).join(', ')})`,
    )
  }).pipe(
    Effect.withSpan('@livestore/common:leader-thread:syncing:rollback', {
      attributes: { count: eventIdsToRollback.length },
    }),
  )

const getCursorInfo = (remoteHead: EventId.GlobalEventId) =>
  Effect.gen(function* () {
    const { dbMutationLog } = yield* LeaderThreadCtx

    if (remoteHead === EventId.ROOT.global) return Option.none()

    const MutationlogQuerySchema = Schema.Struct({
      syncMetadataJson: Schema.parseJson(Schema.Option(Schema.JsonValue)),
    }).pipe(Schema.pluck('syncMetadataJson'), Schema.Array, Schema.head)

    const syncMetadataOption = yield* Effect.sync(() =>
      dbMutationLog.select<{ syncMetadataJson: string }>(
        sql`SELECT syncMetadataJson FROM ${MUTATION_LOG_META_TABLE} WHERE idGlobal = ${remoteHead} ORDER BY idLocal ASC LIMIT 1`,
      ),
    ).pipe(Effect.andThen(Schema.decode(MutationlogQuerySchema)), Effect.map(Option.flatten), Effect.orDie)

    return Option.some({
      cursor: { global: remoteHead, local: EventId.localDefault },
      metadata: syncMetadataOption,
    }) satisfies InitialSyncInfo
  }).pipe(Effect.withSpan('@livestore/common:leader-thread:syncing:getCursorInfo', { attributes: { remoteHead } }))

const backgroundBackendPushing = ({
  dbReady,
  syncBackendQueue,
  otelSpan,
}: {
  dbReady: Deferred.Deferred<void>
  syncBackendQueue: BucketQueue.BucketQueue<MutationEvent.EncodedWithMeta>
  otelSpan: otel.Span | undefined
}) =>
  Effect.gen(function* () {
    const { syncBackend, dbMutationLog } = yield* LeaderThreadCtx
    if (syncBackend === undefined) return

    yield* dbReady

    while (true) {
      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      // TODO make batch size configurable
      const queueItems = yield* BucketQueue.takeBetween(syncBackendQueue, 1, 50)

      yield* SubscriptionRef.waitUntil(syncBackend.isConnected, (isConnected) => isConnected === true)

      otelSpan?.addEvent('backend-push', {
        batchSize: queueItems.length,
        batch: TRACE_VERBOSE ? JSON.stringify(queueItems) : undefined,
      })

      // TODO handle push errors (should only happen during concurrent pull+push)
      const pushResult = yield* syncBackend.push(queueItems.map((_) => _.toGlobal())).pipe(Effect.either)

      if (pushResult._tag === 'Left') {
        otelSpan?.addEvent('backend-push-error', { error: pushResult.left.toString() })
        // wait for interrupt caused by background pulling which will then restart pushing
        return yield* Effect.never
      }

      const { metadata } = pushResult.right

      // TODO try to do this in a single query
      for (let i = 0; i < queueItems.length; i++) {
        const mutationEventEncoded = queueItems[i]!
        yield* execSql(
          dbMutationLog,
          ...updateRows({
            tableName: MUTATION_LOG_META_TABLE,
            columns: mutationLogMetaTable.sqliteDef.columns,
            where: { idGlobal: mutationEventEncoded.id.global, idLocal: mutationEventEncoded.id.local },
            updateValues: { syncMetadataJson: metadata[i]! },
          }),
        )
      }
    }
  }).pipe(Effect.interruptible, Effect.withSpan('@livestore/common:leader-thread:syncing:backend-pushing'))

const trimChangesetRows = (db: SqliteDb, newHead: EventId.EventId) => {
  // Since we're using the session changeset rows to query for the current head,
  // we're keeping at least one row for the current head, and thus are using `<` instead of `<=`
  db.execute(sql`DELETE FROM ${SESSION_CHANGESET_META_TABLE} WHERE idGlobal < ${newHead.global}`)
}
