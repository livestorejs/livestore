import { type MockSyncBackend, makeMockSyncBackend, UnexpectedError } from '@livestore/common'
import { Effect, Layer, SubscriptionRef } from '@livestore/utils/effect'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

export const name = 'Mock Sync Backend'

export const prepare = Effect.void

export const layer: SyncProviderLayer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const currentMockRef = yield* SubscriptionRef.make<MockSyncBackend | undefined>(undefined)

    const withMock = <A>(f: (mock: MockSyncBackend) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const mock = yield* SubscriptionRef.get(currentMockRef)
        if (!mock) {
          return yield* Effect.die('No mock sync backend')
        }
        return yield* f(mock)
      })

    return {
      makeProvider: () =>
        Effect.gen(function* () {
          const mock = yield* makeMockSyncBackend()
          yield* SubscriptionRef.set(currentMockRef, mock)
          return yield* mock.makeSyncBackend
        }),
      turnBackendOffline: withMock((mock) => mock.disconnect),
      turnBackendOnline: withMock((mock) => mock.connect),
      push: (events) => withMock((mock) => mock.advance(...events)),
    }
  }),
).pipe(UnexpectedError.mapToUnexpectedErrorLayer)
