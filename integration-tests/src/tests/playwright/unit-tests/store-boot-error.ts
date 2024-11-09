import { createStore } from '@livestore/livestore'
import { Effect, FiberSet, Schema } from '@livestore/utils/effect'
import { makeInMemoryAdapter } from '@livestore/web'

import { Bridge, schema } from './shared.js'

export const test = () =>
  Effect.gen(function* () {
    const adapter = makeInMemoryAdapter()
    const fiberSet = yield* FiberSet.make()
    const boot = () => Effect.fail(new Error('Boom!'))

    yield* createStore({ schema, adapter, fiberSet, boot, storeId: 'default' })
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(Bridge.ResultStoreBootError)(Bridge.ResultStoreBootError.make({ exit })))
    }),
    Effect.scoped,
    Effect.runPromise,
  )
