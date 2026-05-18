import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { provideOtel } from '@livestore/common'
import { createStore } from '@livestore/livestore'
import { Effect, Schema } from '@livestore/utils/effect'

import { ResultStoreBootError } from './bridge.ts'
import { schema } from './schema.ts'

export class TestError extends Schema.TaggedError<TestError>()('TestError', {
  message: Schema.String,
}) {}

export const test = () =>
  Effect.gen(function* () {
    const adapter = makeInMemoryAdapter()
    const boot = () => new TestError({ message: 'Boom!' })

    yield* createStore({ schema, adapter, boot, storeId: 'default' })
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultStoreBootError)(ResultStoreBootError.make({ exit })))
    }),
    Effect.scoped,
    provideOtel({}),
    Effect.runPromise,
  )
