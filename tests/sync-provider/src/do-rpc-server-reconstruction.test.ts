import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  type Context,
  Data,
  type Duration,
  Effect,
  FetchHttpClient,
  type HttpClient,
  KeyValueStore,
  Layer,
  ManagedRuntime,
  Option,
  Schedule,
  Stream,
} from '@livestore/utils/effect'

import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import { isProviderSelected } from './providers/registry.ts'
import { SyncProviderImpl } from './types.ts'

const idleWindow: Duration.Input = '14 seconds' // past the ~9-11s workerd eviction window
const deliveryTimeout: Duration.Input = '10 seconds'
const testTimeoutMs = 120_000

type RuntimeServices = SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore

const describeDoRpcDo = Vitest.describe.skipIf(isProviderSelected('cf-do-rpc-do') === false)

describeDoRpcDo(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO-RPC server reconstruction`, () => {
  let runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>
  let runtimeContext: Context.Context<RuntimeServices>

  Vitest.beforeAll(async () => {
    runtime = ManagedRuntime.make(
      CloudflareDoRpcProvider.doSqlite.layer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(KeyValueStore.layerMemory),
        Layer.orDie,
      ),
    )
    runtimeContext = await runtime.context()
  })

  Vitest.afterAll(async () => await runtime.dispose())

  Vitest.live(
    'server keeps fanning out to a live DO-RPC subscriber after the backend is reconstructed',
    () => liveDeliverySurvivesBackendReconstruction.pipe(Effect.provide(runtimeContext)),
    testTimeoutMs,
  )
})

class SyncProbeError extends Data.TaggedError('SyncProbeError')<{ message: string }> {}

const syncProvider = Effect.gen(function* () {
  const { makeProvider, providerSpecific } = yield* SyncProviderImpl
  const { port } = providerSpecific
  if (port === undefined) {
    return yield* Effect.die('sync provider did not expose a dev server port')
  }
  return { makeProvider, port }
})

const subscriberClient = EventFactory.clientIdentity('do-rpc-sync-subscriber', 'do-rpc-sync-sub-session')
const writerClient = EventFactory.clientIdentity('do-rpc-sync-writer', 'do-rpc-sync-writer-session')
const makeFactory = EventFactory.makeFactory(events)

const probeSyncDo = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() =>
    fetch(`http://localhost:${port}/instance/sync?storeId=${storeId}`).then((res) => res.json()),
  ).pipe(Effect.map((json) => json as { instanceId: string; webSocketCount: number }))

const probeClientDo = ({ port }: { port: number }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/instance/client`).then((res) => res.json())).pipe(
    Effect.map((json) => json as { instanceId: string }),
  )

// Each probe resets the DO's idle timer, so idle windows are taken one at a time between probes.
const awaitReconstruction = ({ port, storeId, baselineId }: { port: number; storeId: string; baselineId: string }) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 3; attempt++) {
      yield* Effect.sleep(idleWindow)
      const probe = yield* probeSyncDo({ port, storeId })
      if (probe.instanceId !== baselineId) return probe
    }
    return yield* Effect.fail(new SyncProbeError({ message: 'backend never reconstructed within the idle windows' }))
  })

const awaitDelivery = ({ received, id }: { received: ReadonlyArray<string>; id: string }) =>
  Effect.sync(() => received.includes(id)).pipe(
    Effect.flatMap((delivered) =>
      delivered === true ? Effect.void : Effect.fail(new SyncProbeError({ message: `not yet delivered: ${id}` })),
    ),
    Effect.retry(Schedule.spaced('300 millis')),
    Effect.timeoutOrElse({
      duration: deliveryTimeout,
      orElse: () =>
        new SyncProbeError({ message: `live subscriber never received "${id}" within ${String(deliveryTimeout)}` }),
    }),
  )

// A live subscriber keeps receiving events after the backend Durable Object is rebuilt.
//
//   writer ──push──►  BACKEND  ──live fan-out──►  subscriber
//                     (the subscriber list lives in the backend's memory)
//
//   1. warm              push "before"  ──►  received                              ✓
//   2. idle the backend ~14s  ──►  it evicts & rebuilds  ──►  list = { }
//      (the subscriber is pinged every 2s, so only the backend sleeps)
//   3. rebuilt           push "after"   ──►  list empty → fans out to no one → not received
//
// The test asserts "after" is delivered. Red until PR2 persists the backend's
// subscriber list and reloads it on rebuild.
const liveDeliverySurvivesBackendReconstruction = Effect.gen(function* () {
  const { makeProvider, port } = yield* syncProvider
  const storeId = `do-rpc-server-reconstruction-${nanoid()}`
  const received: string[] = []

  const subscriber = yield* makeProvider(
    { storeId, clientId: subscriberClient.clientId, payload: undefined },
    { pingSchedule: Schedule.spaced('2 seconds') }, // keeps the subscriber's client DO warm
  )
  yield* subscriber.connect
  yield* subscriber.pull(Option.none(), { live: true }).pipe(
    Stream.runForEach((res) =>
      Effect.sync(() => {
        for (const item of res.batch) {
          received.push(item.eventEncoded.args.id)
        }
      }),
    ),
    Effect.tapCauseLogPretty,
    Effect.forkScoped,
  )

  const writer = yield* makeProvider({ storeId, clientId: writerClient.clientId, payload: undefined })
  const writerFactory = makeFactory({ client: writerClient, startSeq: 1, initialParent: 'root' })
  yield* writer.connect

  yield* Effect.sleep('1 second')
  yield* writer.push([writerFactory.todoCreated.next({ id: 'before-evict', text: 'before', completed: false })])
  yield* awaitDelivery({ received, id: 'before-evict' })

  const syncBefore = yield* probeSyncDo({ port, storeId })
  const clientBefore = yield* probeClientDo({ port })

  const syncAfter = yield* awaitReconstruction({ port, storeId, baselineId: syncBefore.instanceId })
  const clientAfter = yield* probeClientDo({ port })

  expect(syncAfter.instanceId).not.toBe(syncBefore.instanceId)
  expect(clientAfter.instanceId).toBe(clientBefore.instanceId)

  yield* writer.push([writerFactory.todoCreated.next({ id: 'after-evict', text: 'after', completed: false })])
  yield* awaitDelivery({ received, id: 'after-evict' })
})
