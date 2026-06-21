import { Vitest } from '@livestore/utils-dev/node-vitest'
import { Effect, Fiber, Latch, Stream, SubscriptionRef } from '@livestore/utils/effect'

import { makeMockSyncBackend } from '../sync/mock-sync-backend.ts'
import type { SyncBackend } from '../sync/sync.ts'
import { makeNetworkStatusSubscribable } from './make-leader-thread-layer.ts'
import type { DevtoolsContext } from './types.ts'

Vitest.describe('makeNetworkStatusSubscribable', () => {
  Vitest.live('tracks sync backend connectivity and devtools latch state', () =>
    Effect.gen(function* () {
      const mockBackend = yield* makeMockSyncBackend({ startConnected: false })
      const syncBackend = yield* mockBackend.makeSyncBackend
      const latchStateRef = yield* SubscriptionRef.make<{ latchClosed: boolean }>({ latchClosed: false })

      const devtoolsContext: DevtoolsContext = {
        enabled: true,
        syncBackendLatch: yield* Latch.make(true),
        syncBackendLatchState: latchStateRef,
      }

      const networkStatus = yield* makeNetworkStatusSubscribable({ syncBackend, devtoolsContext })

      const initial = yield* networkStatus
      Vitest.expect(initial.isConnected).toBe(false)
      Vitest.expect(initial.devtools.latchClosed).toBe(false)

      const waitFor = (predicate: (status: SyncBackend.NetworkStatus) => boolean) =>
        networkStatus.changes.pipe(Stream.filter(predicate), Stream.runFirstUnsafe)

      const onlineFiber = yield* waitFor((status) => status.isConnected).pipe(
        // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
        Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
      )
      yield* mockBackend.connect
      const online = yield* Fiber.join(onlineFiber)
      Vitest.expect(online.isConnected).toBe(true)
      Vitest.expect(online.timestampMs).toBeGreaterThan(initial.timestampMs)

      const latchedFiber = yield* waitFor((status) => status.devtools.latchClosed).pipe(
        // TODO: These options were set to preserve Effect v3 fork behavior while migrating to Effect v4. Verify if they're the most appropriate configuration for this specific fork.
        Effect.forkScoped({ startImmediately: true, uninterruptible: 'inherit' }),
      )
      yield* SubscriptionRef.set(latchStateRef, { latchClosed: true })
      const latched = yield* Fiber.join(latchedFiber)
      Vitest.expect(latched.devtools.latchClosed).toBe(true)
      Vitest.expect(latched.timestampMs).toBeGreaterThanOrEqual(online.timestampMs)
    }),
  )
})
