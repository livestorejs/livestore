import type { BootStatus } from '@livestore/common'
import { Effect, Queue, Schedule, Schema } from '@livestore/utils/effect'
import { makeAdapter } from '@livestore/web'

// @ts-expect-error Worker import via Vite
import LiveStoreWorker from './livestore.worker?worker'
import { Bridge, schema } from './shared.js'

export const test = () =>
  Effect.gen(function* () {
    const bootStatusQueue = yield* Queue.unbounded<BootStatus>()

    const _adapter = yield* makeAdapter({ storage: { type: 'opfs' }, worker: LiveStoreWorker })({
      schema,
      devtoolsEnabled: false,
      bootStatusQueue,
    })

    // const bootStatusUpdates = yield* Queue.takeAll(bootStatusQueue).pipe(Effect.map(Chunk.toReadonlyArray))

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
      window.postMessage(Schema.encodeSync(Bridge.Result)(Bridge.Result.make({ exit })))
    }),
    Effect.runPromise,
  )
