import { shouldNeverHappen } from '@livestore/utils'
import type { HttpClient, Scope } from '@livestore/utils/effect'
import { Chunk, Deferred, Effect, Option, Queue, Schema } from '@livestore/utils/effect'

import {
  compareEventIds,
  type EventId,
  ROOT_ID,
  type SynchronousDatabase,
  type UnexpectedError,
} from '../adapter-types.js'
import * as Devtools from '../devtools/index.js'
import {
  type LiveStoreSchema,
  type MutationEvent,
  mutationLogMetaTable,
  SYNC_STATUS_TABLE,
  syncStatusTable,
} from '../schema/index.js'
import { updateRows } from '../sql-queries/index.js'
import type { SyncBackend } from '../sync/sync.js'
import { prepareBindValues, sql } from '../util.js'
import { liveStoreVersion } from '../version.js'
import { makeApplyMutation } from './apply-mutation.js'
import { execSql } from './connection.js'
import { LeaderThreadCtx } from './types.js'

/**
 * NOTE rebasing can be deferred arbitrarily long - a client is in a non-connected state if it hasn't rebased yet
 *
 * TODO figure out how client session interacts with rebasing
 * Maybe use some kind of weblock to coordinate across threads?
 *
 * TODO ideally design/build this function in a way so it can also be used in client sessions (i.e. without a persisted mutation log)
 *
 * Concurrency notes:
 * - LiveStore can't process new mutations while rebasing is in progress
 * -
 */
export const rebasePushQueue = (newUpstreamEvents: MutationEvent.AnyEncoded[]) =>
  Effect.andThen(
    LeaderThreadCtx,
    (ctx) =>
      Effect.gen(function* () {
        const { syncPushQueue } = ctx
        // const { syncPushQueue } = yield* LeaderThreadCtx

        // yield* syncPushQueue.isOpen.close
        // TODO implement rebasing

        // Overall plan:
        // Step 1: Build rebased mutation log
        // Step 2: Rollback and apply rebased mutation log

        // Step 1:
        // const queueItems = yield* Queue.takeAll(syncPushQueue.queue)

        const headGlobalId = newUpstreamEvents.at(-1)!.id.global

        // TODO properly handle local-only events
        // const rebasedLocalEvents = [...queueItems].map((item, index) => ({
        //   ...item,
        //   id: { global: headGlobalId + index + 1, local: 0 } satisfies EventId,
        //   parentId: { global: headGlobalId + index, local: 0 } satisfies EventId,
        // }))

        // TODO use proper event rebasing (with facts, rebaseFn etc)
        // const rebasedItems = [...newUpstreamEvents, ...rebasedLocalEvents]

        // Rollback mutations

        // Also update mutation log db rows

        // yield* syncPushQueue.isOpen.open
      }),
    // .pipe(ctx.syncPushQueue.semaphore.withPermits(1)),
  )
// .pipe(syncPushQueueSemaphore.withPermits(1))

// TODO use a push queue abstraction that's automatically persisted or allows for an in-memory implementation

/**
 * The push queue represents the "tail" of the mutation log i.e. events that haven't been pushed yet.
 *
 * Mutation Log visualization:
 *
 * ```
 *                    Remote Head         Local Head
 *                         ▼                   ▼
 *   [-1]->[0]->[1]->[2]->[3]->[4]->[5]->[6]->[7]
 *  (Root)                      └─ Push Queue ─┘
 *                              (unpushed events)
 * ```
 *
 * - Events Root-3: Already pushed/confirmed events (Remote Head at 3)
 * - Events 4-6: Events in push queue (not yet pushed/confirmed)
 */
export interface PushQueueLeader {
  syncDb: SynchronousDatabase

  // TODO maybe use a TRef
  items: PushQueueItemLeader[]

  syncQueue: Queue.Queue<MutationEvent.AnyEncoded>

  // TODO move this function into a "mutation log" abstraction
  getNewMutationEvents: (since: EventId) => Effect.Effect<ReadonlyArray<MutationEvent.AnyEncoded>, UnexpectedError>

  onNewPullChunk: (chunk: MutationEvent.AnyEncoded[]) => Effect.Effect<void, never, LeaderThreadCtx>

  push: (items: PushQueueItemLeader[]) => Effect.Effect<void, UnexpectedError, HttpClient.HttpClient>
  executeMutationsLoop: Effect.Effect<void, UnexpectedError, LeaderThreadCtx | Scope.Scope | HttpClient.HttpClient>
  currentMutationEventIdRef: { current: EventId }
  syncHeadRef: { current: number }
}

export const makePushQueueLeader = ({
  db,
  dbLog,
  schema,
  syncBackend,
  currentMutationEventIdRef,
}: {
  db: SynchronousDatabase
  dbLog: SynchronousDatabase
  schema: LiveStoreSchema
  syncBackend: SyncBackend | undefined
  currentMutationEventIdRef: { current: EventId }
}): Effect.Effect<PushQueueLeader, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const mode = 'leader'

    const localItems: PushQueueItemLeader[] = []

    const executeQueue = yield* Queue.unbounded<{
      mutationEventEncoded: MutationEvent.AnyEncoded
      // syncStatus: 'pending' | 'synced'
      deferred: Deferred.Deferred<void> | undefined
    }>().pipe(Effect.acquireRelease(Queue.shutdown))

    const syncQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>().pipe(Effect.acquireRelease(Queue.shutdown))

    // const syncPushQueueSemaphore = yield* Effect.makeSemaphore(1)
    // const syncPushQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>()

    // const isNotRebasingLatch = yield* Effect.makeLatch(false)

    const syncHeadRef = { current: 0 }

    const executeMutationsLoop = Effect.gen(function* () {
      const leaderThreadCtx = yield* LeaderThreadCtx
      const { syncPushQueue, dbLog } = leaderThreadCtx

      const initialSyncHead =
        dbLog.select<{ head: number }>(sql`select head from ${SYNC_STATUS_TABLE}`)[0]?.head ?? ROOT_ID.global
      console.log('sync status', dbLog.select(sql`select * from ${SYNC_STATUS_TABLE}`))
      console.log('initialSyncHead', initialSyncHead)

      syncHeadRef.current = initialSyncHead

      // rehydrate pushQueue from dbLog
      {
        const query = mutationLogMetaTable.query.where('idGlobal', '>', initialSyncHead).asSql()
        const pendingMutationEventsRaw = dbLog.select(query.query, prepareBindValues(query.bindValues, query.query))
        const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
          pendingMutationEventsRaw,
        )

        yield* syncPushQueue.push(
          pendingMutationEvents.map((_) => ({
            mutationEventEncoded: {
              mutation: _.mutation,
              args: _.argsJson,
              id: { global: _.idGlobal, local: _.idLocal },
              parentId: { global: _.parentIdGlobal, local: _.parentIdLocal },
            },
            // syncStatus: 'pending',
          })),
        )
      }

      const applyMutation = yield* makeApplyMutation

      yield* Effect.gen(function* () {
        const batchItems = yield* Queue.takeBetween(executeQueue, 1, 50)

        try {
          db.execute('BEGIN TRANSACTION', undefined) // Start the transaction
          dbLog.execute('BEGIN TRANSACTION', undefined) // Start the transaction

          // batchItems = executionItems.slice(offset, offset + 50)
          // offset += 50

          // console.group('livestore-webworker: executing batch')
          // batchItems.forEach((_) => {
          //   if (_._tag === 'execute') {
          //     console.log(_.query, _.bindValues)
          //   } else if (_._tag === 'mutate') {
          //     console.log(_.mutationEventEncoded.mutation, _.mutationEventEncoded.id, _.mutationEventEncoded.args)
          //   }
          // })
          // console.groupEnd()

          for (const { mutationEventEncoded, deferred } of batchItems) {
            // if (item._tag === 'mutate') {
            // const mutationDef =
            //   schema.mutations.get(mutationEventEncoded.mutation) ??
            //   shouldNeverHappen(`Unknown mutation: ${mutationEventEncoded.mutation}`)

            yield* applyMutation(mutationEventEncoded, {
              // persisted: item.persisted,
              persisted: true,
              inTransaction: true,
              // syncStatus,
              // syncStatus: mutationDef.options.localOnly ? 'localOnly' : syncStatus,
              syncMetadataJson: Option.none(),
            })
            // } else {
            //   // TODO handle txn
            // }

            // Now we're sending the mutation event to all "pulling" client sessions
            for (const queue of leaderThreadCtx.connectedClientSessionPullQueues) {
              // TODO do batching if possible
              yield* Queue.offer(queue, { mutationEvents: [mutationEventEncoded], remaining: 0 })
            }

            if (leaderThreadCtx.devtools.enabled) {
              // TODO consider to refactor devtools to use syncing mechanism instead of devtools-specific broadcast channel
              yield* leaderThreadCtx.devtools.broadcast(
                Devtools.MutationBroadcast.make({ mutationEventEncoded, persisted: true, liveStoreVersion }),
              )
            }

            if (deferred) {
              yield* Deferred.succeed(deferred, void 0)
            }
          }

          db.execute('COMMIT', undefined) // Commit the transaction
          dbLog.execute('COMMIT', undefined) // Commit the transaction
        } catch (error) {
          try {
            db.execute('ROLLBACK', undefined) // Rollback in case of an error
            dbLog.execute('ROLLBACK', undefined) // Rollback in case of an error
          } catch (e) {
            console.error('Error rolling back transaction', e)
          }

          shouldNeverHappen(`Error executing query: ${error} \n ${JSON.stringify(batchItems)}`)
        }
      }).pipe(Effect.forever, Effect.interruptible, Effect.tapCauseLogPretty, Effect.forkScoped)
    })

    // TODO continously push to sync backend

    return {
      syncDb: db,
      items: localItems,
      syncQueue,
      executeMutationsLoop,
      currentMutationEventIdRef,
      syncHeadRef,
      onNewPullChunk: (chunk) =>
        Effect.gen(function* () {
          if (chunk.length === 0) return

          // TODO either use `sessionId` to verify or introduce a new nanoid-field
          const hasLocalPendingEvents = false

          if (hasLocalPendingEvents) {
            const matchesPendingEvents = true

            if (matchesPendingEvents) {
              // apply chunk to read model

              if (mode === 'leader') {
                // forward chunk to client sessions
                // remove from items
              } else {
                // if confirmed by sync backend, remove from items
              }
            } else {
              // rebase
              // yield* rebasePushQueue(chunk)
            }
          } else {
            yield* executeQueue.offerAll(chunk.map((_) => ({ mutationEventEncoded: _, deferred: undefined })))

            const head = chunk.at(-1)!.id.global

            yield* execSql(dbLog, sql`UPDATE ${SYNC_STATUS_TABLE} SET head = ${head}`, {}).pipe(Effect.orDie)

            syncHeadRef.current = head
            console.log('syncHeadRef', syncHeadRef.current)
          }
        }),
      push: (items) =>
        Effect.gen(function* () {
          localItems.push(...items)

          // TODO handle rebase
          yield* syncQueue.offerAll(
            items
              .filter((item) => {
                const mutationDef = schema.mutations.get(item.mutationEventEncoded.mutation)!
                return mutationDef.options.localOnly === false
              })
              .map((item) => item.mutationEventEncoded),
          )

          // In case of leader thread:
          // For mutation event coming from client session, we want to ...
          // - reject if it's behind, and wait for it to pull + rebase itself
          // - broadcast to other connected client sessions
          // - write to mutation log + apply to read model
          // - push to sync backend

          yield* executeQueue.offerAll(
            items.map((item) => ({
              mutationEventEncoded: item.mutationEventEncoded,
              syncStatus: 'pending',
              deferred: item.deferred,
            })),
          )

          // TODO handle rebase
        }),
      // TODO move this function into a "mutation log" abstraction
      getNewMutationEvents: (since: EventId) =>
        Effect.gen(function* () {
          const query = mutationLogMetaTable.query.where('idGlobal', '>=', since.global).asSql()
          const pendingMutationEventsRaw = dbLog.select(query.query, prepareBindValues(query.bindValues, query.query))
          const pendingMutationEvents = Schema.decodeUnknownSync(mutationLogMetaTable.schema.pipe(Schema.Array))(
            pendingMutationEventsRaw,
          )

          return pendingMutationEvents
            .map((_) => ({
              mutation: _.mutation,
              args: _.argsJson,
              id: { global: _.idGlobal, local: _.idLocal },
              parentId: { global: _.parentIdGlobal, local: _.parentIdLocal },
            }))
            .filter((_) => compareEventIds(_.id, since) > 0)
        }),
    } satisfies PushQueueLeader
  })

export interface PushQueueItemLeader {
  mutationEventEncoded: MutationEvent.AnyEncoded
  // syncStatus: 'confirmed' | 'pending' | 'localOnly'
  deferred?: Deferred.Deferred<void>
}

export interface PushQueueClientSession {
  syncDb: SynchronousDatabase
  mode: 'client-session'

  // TODO maybe use a TRef
  items: PushQueueItemClientSession[]

  onNewPullChunk: (chunk: MutationEvent.AnyEncoded[]) => Effect.Effect<void, never, LeaderThreadCtx>
}

export interface PushQueueItemClientSession {
  mutationEventEncoded: MutationEvent.AnyEncoded
  syncStatus: 'accepted-by-leader' | 'confirmed' | 'pending'
}

/*
Decision how event interact with push queue:
- if it's coming from sync backend, it's confirmed -> remove from queue
- if it's coming from client session, it's not confirmed -> add to queue

Question: should the push queue follow something else or should something else follow the push queue?

- Push queue needs to rebase for new pull events which don't match the local push queue state
  - Rebase triggers updates to the push queue state + read model state


Question: how should the client session deal with rebase results from the leader thread?
- Idea: 
- client session push queue needs to keep items around until confirmed by the sync backend

Question: Should the client session push queue even care about confirmation by the leader thread or is it only interested in the sync backend confirmation?
- answer: yes, it's relevant because we need to make sure each client session is consistent - especially when the client is offline
*/
