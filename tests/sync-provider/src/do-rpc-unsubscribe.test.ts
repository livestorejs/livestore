import { expect } from 'vitest'

import { nanoid } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { type Duration, Effect, Schedule } from '@livestore/utils/effect'

import { setupProviderRuntime, SyncDoProbeError, syncProvider } from './do-idle-helpers.ts'
import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import { isProviderSelected } from './providers/registry.ts'

const idleWindow: Duration.Input = '20 seconds' // workerd evicts somewhere between 9s and 11s idle

// Selected by provider key, not by suite title, so renaming this suite cannot drop it from CI.
const describeDoRpcDo = Vitest.describe.skipIf(isProviderSelected('cf-do-rpc-do') === false)

describeDoRpcDo(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO-RPC graceful unsubscribe`, () => {
  const getContext = setupProviderRuntime(CloudflareDoRpcProvider.doSqlite.layer)

  Vitest.live('shutting down a live-pull store drops its DO-RPC subscription on the server', () =>
    dropsSubscriptionOnStoreShutdown.pipe(Effect.provide(getContext())),
  )

  Vitest.live(
    'an evicted (hibernated) client keeps its DO-RPC subscription so a woken client still gets its echo',
    () => subscriptionSurvivesClientEviction.pipe(Effect.provide(getContext())),
    60_000,
  )
})

// A real store (StoreClientDo, livePull) subscribes on boot. An explicit `store.shutdown()` is a graceful
// client-done — the sync backend scope closes and finalizers run — which is distinct from hibernation/eviction
// (which runs no finalizers). So the server-side subscription row must be dropped on shutdown.
const dropsSubscriptionOnStoreShutdown = Effect.gen(function* () {
  const { port } = yield* syncProvider
  const storeId = `do-rpc-unsubscribe-${nanoid()}`

  yield* bootStoreClient({ port, storeId })
  const openCount = yield* awaitSubscriptionCount({ port, storeId, expected: 1 })
  expect(openCount).toBe(1)

  yield* disposeStoreClient({ port, storeId })
  const afterShutdownCount = yield* awaitSubscriptionCount({ port, storeId, expected: 0 })
  expect(afterShutdownCount).toBe(0)
})

// Regression guard for the safety property: CF eviction runs no JS, so no finalizer fires — the subscription row
// must survive so a woken client still receives its reverse-RPC echo. Passes with AND without the graceful
// finalizer today; it would fail only if idle/hibernation-adjacent disposal ever started dropping the row.
const subscriptionSurvivesClientEviction = Effect.gen(function* () {
  const { port } = yield* syncProvider
  const storeId = `do-rpc-eviction-guard-${nanoid()}`

  yield* bootStoreClient({ port, storeId })
  const openCount = yield* awaitSubscriptionCount({ port, storeId, expected: 1 })
  expect(openCount).toBe(1)

  const before = yield* probeStoreClient({ port, storeId })

  // Idle past the eviction window without touching the client DO (no push → nothing wakes or re-boots it).
  yield* Effect.sleep(idleWindow)

  // Probing reconstructs the store-less client: a changed instanceId proves it was actually evicted, not just idle.
  const after = yield* probeStoreClient({ port, storeId })
  expect(after.instanceId).not.toBe(before.instanceId)

  const survivingCount = yield* awaitSubscriptionCount({ port, storeId, expected: 1 })
  expect(survivingCount).toBe(1)
})

const bootStoreClient = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/store/boot?storeId=${storeId}`, { method: 'POST' }))

const disposeStoreClient = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/store/dispose?storeId=${storeId}`, { method: 'POST' }))

const probeStoreClient = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/store/probe?storeId=${storeId}`).then((res) => res.json())).pipe(
    Effect.map((json) => json as { instanceId: string; todoIds: ReadonlyArray<string> }),
  )

const readSubscriptionCount = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() =>
    fetch(`http://localhost:${port}/instance/rpc-subs?storeId=${storeId}`).then((res) => res.json()),
  ).pipe(Effect.map((json) => (json as { count: number }).count))

/** Polls the subscription probe until it reads `expected`; on timeout returns the last observed count for a precise assertion. */
const awaitSubscriptionCount = (
  { port, storeId, expected }: { port: number; storeId: string; expected: number },
  timeout: Duration.Input = '15 seconds',
) =>
  readSubscriptionCount({ port, storeId }).pipe(
    Effect.flatMap((count) =>
      count === expected
        ? Effect.succeed(count)
        : Effect.fail(new SyncDoProbeError({ message: `subscription count is ${count}, expected ${expected}` })),
    ),
    Effect.retry(Schedule.spaced('300 millis')),
    Effect.timeoutOrElse({ duration: timeout, orElse: () => readSubscriptionCount({ port, storeId }) }),
  )
