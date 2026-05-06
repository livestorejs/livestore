import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { Effect, Queue, Schema } from '@livestore/utils/effect'

import { ResultBootStatus } from './bridge.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { schema } from './schema.ts'

export const test = () =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

    const clientSession = yield* makePersistedAdapter({
      storage: { type: 'opfs' },
      worker: LiveStoreWorker,
      sharedWorker: LiveStoreSharedWorker,
    })({
      schema,
      storeId: 'default',
      devtoolsEnabled: false,
      bootStatusQueue,
      shutdown: () => Effect.void,
      connectDevtoolsToStore: () => Effect.void,
      debugInstanceId: 'test',
      syncPayloadEncoded: undefined,
      syncPayloadSchema: undefined,
    })

    // NOTE We can't use `Queue.takeAll` since sometimes it takes a bit longer for the updates to come in
    const bootStatusUpdates: BootStatus[] = []
    while (true) {
      const update = yield* Queue.take(bootStatusQueue)
      bootStatusUpdates.push(update)
      if (update.stage === 'done') break
    }

    return { bootStatusUpdates, migrationsReport: clientSession.leaderThread.initialState.migrationsReport }
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultBootStatus)(ResultBootStatus.make({ exit })))
    }),
    Effect.scoped,
    Effect.runPromise,
  )
