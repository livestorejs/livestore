import { Effect, Stream, SubscriptionRef } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'

import { makeMockSyncBackend } from '../sync/mock-sync-backend.ts'
import type { SyncBackend } from '../sync/sync.ts'
import { makeNetworkStatusSubscribable } from './make-leader-thread-layer.ts'
import type { DevtoolsContext } from './types.ts'

Vitest.describe('makeNetworkStatusSubscribable', () => {
  Vitest.scopedLive('tracks sync backend connectivity and devtools latch state', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: false })
      const syncBackend = yield* mockBackend.makeSyncBackend
      const latchStateRef = yield* SubscriptionRef.make<{ latchClosed: boolean }>({ latchClosed: false })

      const devtoolsContext: DevtoolsContext = {
        enabled: true,
        syncBackendLatch: yield* Effect.makeLatch(true),
        syncBackendLatchState: latchStateRef,
      }

      const networkStatus = yield* makeNetworkStatusSubscribable({ syncBackend, devtoolsContext })

      const initial = yield* networkStatus
      Vitest.expect(initial.isConnected).toBe(false)
      Vitest.expect(initial.devtools.latchClosed).toBe(false)

      const waitFor = (predicate: (status: SyncBackend.NetworkStatus) => boolean) =>
        networkStatus.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.flatten)

      const onlineFiber = yield* waitFor((status) => status.isConnected).pipe(Effect.forkScoped)
      yield* mockBackend.connect
      const online = yield* onlineFiber
      Vitest.expect(online.isConnected).toBe(true)
      Vitest.expect(online.timestampMs).toBeGreaterThan(initial.timestampMs)

      const latchedFiber = yield* waitFor((status) => status.devtools.latchClosed).pipe(Effect.forkScoped)
      yield* SubscriptionRef.set(latchStateRef, { latchClosed: true })
      const latched = yield* latchedFiber
      Vitest.expect(latched.devtools.latchClosed).toBe(true)
      Vitest.expect(latched.timestampMs).toBeGreaterThanOrEqual(online.timestampMs)
    }),
  )
})
