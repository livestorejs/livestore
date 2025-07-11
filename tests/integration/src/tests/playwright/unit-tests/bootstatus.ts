import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { Effect, Queue, Schedule, Schema } from '@livestore/utils/effect'

import LiveStoreWorker from './livestore.worker.ts?worker'
import { Bridge, schema } from './shared.ts'

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
      syncPayload: undefined,
    })

    // NOTE We can't use `Queue.takeAll` since sometimes it takes a bit longer for the updates to come in
    const bootStatusUpdates: BootStatus[] = []
    yield* Queue.take(bootStatusQueue).pipe(
      Effect.tapSync((update) => bootStatusUpdates.push(update)),
      Effect.repeat(Schedule.forever.pipe(Schedule.untilInput((_: BootStatus) => _.stage === 'done'))),
    )

    return { bootStatusUpdates, migrationsReport: clientSession.leaderThread.initialState.migrationsReport }
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(Bridge.ResultBootStatus)(Bridge.ResultBootStatus.make({ exit })))
    }),
    Effect.scoped,
    Effect.runPromise,
  )
