import type { Scope, WebChannel } from '@livestore/utils/effect'
import { Deferred, Effect, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

import {
  type BootStatus,
  type MakeSynchronousDatabase,
  ROOT_ID,
  type SynchronousDatabase,
  type UnexpectedError,
} from '../adapter-types.js'
import type { LiveStoreSchema, MutationEvent } from '../schema/index.js'
import { makeMutationEventSchema } from '../schema/index.js'
import { makeNextMutationEventIdPair } from '../sync/next-mutation-event-id-pair.js'
import type { SyncBackend } from '../sync/sync.js'
import { makeDevtoolsContext } from './leader-worker-devtools.js'
import type { BCMessage } from './mod.js'
import type { DevtoolsContext, InitialSetup, InitialSyncOptions, LeaderThreadCtx, ShutdownState } from './types.js'

export const makeLeaderThreadCtx = ({
  schema,
  storeId,
  originId,
  makeSyncDb,
  makeSyncBackend,
  db,
  dbLog,
  devtoolsEnabled,
  initialSyncOptions,
  broadcastChannel,
}: {
  storeId: string
  originId: string
  schema: LiveStoreSchema
  makeSyncDb: MakeSynchronousDatabase
  makeSyncBackend: Effect.Effect<SyncBackend, UnexpectedError, Scope.Scope> | undefined
  db: SynchronousDatabase
  dbLog: SynchronousDatabase
  devtoolsEnabled: boolean
  initialSyncOptions: InitialSyncOptions | undefined
  broadcastChannel: WebChannel.WebChannel<BCMessage.Message, BCMessage.Message>
}): Effect.Effect<typeof LeaderThreadCtx.Service, UnexpectedError, Scope.Scope> =>
  Effect.gen(function* () {
    const mutationEventSchema = makeMutationEventSchema(schema)
    const mutationDefSchemaHashMap = new Map(
      // TODO Running `Schema.hash` can be a bottleneck for larger schemas. There is an opportunity to run this
      // at build time and lookup the pre-computed hash at runtime.
      // Also see https://github.com/Effect-TS/effect/issues/2719
      [...schema.mutations.entries()].map(([k, v]) => [k, Schema.hash(v.schema)] as const),
    )

    const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

    // TODO get rid of this
    const initialSetupDeferred = yield* Deferred.make<InitialSetup, UnexpectedError>()

    const mutationSemaphore = yield* Effect.makeSemaphore(1)

    const devtools: DevtoolsContext = devtoolsEnabled ? yield* makeDevtoolsContext : { enabled: false }

    const shutdownStateSubRef = yield* SubscriptionRef.make<ShutdownState>('running')

    // TODO restore id from db
    const currentMutationEventIdRef = { current: ROOT_ID }
    const nextMutationEventIdPair = makeNextMutationEventIdPair(currentMutationEventIdRef)

    const syncBackend = makeSyncBackend === undefined ? undefined : yield* makeSyncBackend

    if (syncBackend !== undefined && initialSyncOptions?._tag === 'Blocking') {
      const waitUntilOnline = syncBackend.isConnected.changes.pipe(
        Stream.filter(Boolean),
        Stream.take(1),
        Stream.runDrain,
      )

      // Wait first until we're online
      yield* waitUntilOnline.pipe(Effect.timeout(initialSyncOptions.timeout), Effect.ignore)
    }

    const syncPushQueueSemaphore = yield* Effect.makeSemaphore(1)
    const syncPushQueue = yield* Queue.unbounded<MutationEvent.AnyEncoded>()

    const isNotRebasingLatch = yield* Effect.makeLatch(false)

    /**
     * NOTE rebasing can be deferred arbitrarily long - a client is in a non-connected state if it hasn't rebased yet
     *
     * TODO figure out how client session interacts with rebasing
     * Maybe use some kind of weblock to coordinate across threads?
     *
     * Concurrency notes:
     * - LiveStore can't process new mutations while rebasing is in progress
     * -
     */
    const rebasePushQueue = (newUpstreamEvents: MutationEvent.AnyEncoded[]) =>
      Effect.gen(function* () {
        yield* isNotRebasingLatch.close
        // TODO implement rebasing

        // Step 1: Build rebased mutation log

        // Step 2: Rollback and apply rebased mutation log

        const queueItems = yield* Queue.takeAll(syncPushQueue)

        // Rollback mutations

        yield* isNotRebasingLatch.open
      }).pipe(syncPushQueueSemaphore.withPermits(1))

    return {
      schema,
      mutationDefSchemaHashMap,
      bootStatusQueue,
      initialSetupDeferred,
      mutationSemaphore,
      storeId,
      originId,
      broadcastChannel,
      currentMutationEventIdRef,
      db,
      dbLog,
      devtools,
      initialSyncOptions: initialSyncOptions ?? { _tag: 'Skip' },
      makeSyncDb,
      mutationEventSchema,
      nextMutationEventIdPair,
      shutdownStateSubRef,
      syncBackend,
      syncPushQueue,
      syncPushQueueSemaphore,
    } satisfies typeof LeaderThreadCtx.Service
  })
