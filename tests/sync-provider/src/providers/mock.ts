import { type MockSyncBackend, makeMockSyncBackend, UnexpectedError } from '@livestore/common'
import { Effect, Layer, Ref } from '@livestore/utils/effect'
import { SyncProviderImpl, type SyncProviderLayer } from '../types.ts'

export const name = 'Mock Sync Backend'

export const prepare = Effect.void

export const layer: SyncProviderLayer = Layer.scoped(
  SyncProviderImpl,
  Effect.gen(function* () {
    const mocksRef = yield* Ref.make(new Map<string, MockSyncBackend>())

    const getOrCreateMock = (storeId: string) =>
      Effect.gen(function* () {
        const mocks = yield* Ref.get(mocksRef)
        const existing = mocks.get(storeId)
        if (existing !== undefined) {
          return existing
        }

        const created = yield* makeMockSyncBackend()
        yield* Ref.update(mocksRef, (prev) => {
          const next = new Map(prev)
          next.set(storeId, created)
          return next
        })
        return created
      })

    const broadcastToMocks = <A>(f: (mock: MockSyncBackend) => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const mocks = yield* Ref.get(mocksRef)
        if (mocks.size === 0) {
          return
        }
        yield* Effect.forEach(mocks.values(), f, { concurrency: 'unbounded' })
      })

    return {
      makeProvider: ({ storeId }) =>
        Effect.gen(function* () {
          const mock = yield* getOrCreateMock(storeId)
          return yield* mock.makeSyncBackend
        }),
      turnBackendOffline: broadcastToMocks((mock) => mock.disconnect),
      turnBackendOnline: broadcastToMocks((mock) => mock.connect),
      providerSpecific: {},
    }
  }),
).pipe(UnexpectedError.mapToUnexpectedErrorLayer)
