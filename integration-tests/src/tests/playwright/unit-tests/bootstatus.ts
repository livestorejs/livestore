import type { BootStatus } from '@livestore/common'
import { Effect, Queue, Schedule, Schema } from '@livestore/utils/effect'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'

import LiveStoreWorker from './livestore.worker?worker'
import { Bridge, schema } from './shared.js'

export const test = () =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

    const _adapter = yield* makeAdapter({
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
    })

    // NOTE We can't use `Queue.takeAll` since sometimes it takes a bit longer for the updates to come in
    const bootStatusUpdates: BootStatus[] = []
    yield* Queue.take(bootStatusQueue).pipe(
      Effect.tapSync((update) => bootStatusUpdates.push(update)),
      Effect.repeat(Schedule.forever.pipe(Schedule.untilInput((_: BootStatus) => _.stage === 'done'))),
    )

    return { bootStatusUpdates }
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(Bridge.ResultBootStatus)(Bridge.ResultBootStatus.make({ exit })))
    }),
    Effect.scoped,
    Effect.runPromise,
  )
