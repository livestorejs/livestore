import type { Scope } from '@livestore/utils/effect'
import { Effect, Queue, Schema, Stream, SubscriptionRef } from '@livestore/utils/effect'

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
import type { DevtoolsContext, InitialSyncOptions, LeaderThreadCtx, ShutdownState } from './types.js'

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

    const connectedClientSessionPullQueues = new Set<Queue.Queue<MutationEvent.AnyEncoded>>()

    return {
      schema,
      mutationDefSchemaHashMap,
      bootStatusQueue,
      mutationSemaphore,
      storeId,
      originId,
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
      syncPushQueue: {
        queue: syncPushQueue,
        semaphore: syncPushQueueSemaphore,
        isOpen: isNotRebasingLatch,
      },
      connectedClientSessionPullQueues,
    } satisfies typeof LeaderThreadCtx.Service
  })
