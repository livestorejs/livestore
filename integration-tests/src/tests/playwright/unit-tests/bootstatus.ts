import type { BootStatus } from '@livestore/common'
import { Chunk, Effect, Queue, Schema } from '@livestore/utils/effect'
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
      devtoolsEnabled: false,
      bootStatusQueue,
      shutdown: () => Effect.void,
    })

    const bootStatusUpdates = yield* Queue.takeAll(bootStatusQueue).pipe(Effect.map(Chunk.toReadonlyArray))

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
