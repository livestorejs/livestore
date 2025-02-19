import { provideOtel } from '@livestore/common'
import { createStore } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'
import { makeInMemoryAdapter } from '@livestore/adapter-web'

import { Bridge, schema } from './shared.js'

export const test = () =>
  Effect.gen(function* () {
    const adapter = makeInMemoryAdapter()
    const boot = () => Effect.fail(new Error('Boom!'))

    yield* createStore({ schema, adapter, boot, storeId: 'default' })
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(Bridge.ResultStoreBootError)(Bridge.ResultStoreBootError.make({ exit })))
    }),
    Effect.scoped,
    provideOtel({}),
    Effect.runPromise,
  )
