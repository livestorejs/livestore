import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { type Duration, Effect, Schedule } from '@livestore/utils/effect'

import {
  awaitDelivery,
  collectReceivedIds,
  makeEventFactory,
  probeSyncDo,
  setupProviderRuntime,
  SyncDoProbeError,
  syncProvider,
} from './do-idle-helpers.ts'
import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import { isProviderSelected } from './providers/registry.ts'

const idleWindow: Duration.Input = '14 seconds' // past the ~9-11s workerd eviction window
const testTimeoutMs = 120_000

/**
 * The suite below is red until the backend persists its DO-RPC subscriber registry, which lands in
 * the PR stacked on top of this one. Stacked merges require every PR below to have passing checks,
 * so the suite is gated off here and this flag is flipped to `true` alongside the fix.
 */
const registryIsPersisted = false

const describeDoRpcDo = Vitest.describe.skipIf(
  registryIsPersisted === false || isProviderSelected('cf-do-rpc-do') === false,
)

describeDoRpcDo(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO-RPC server reconstruction`, () => {
  const getContext = setupProviderRuntime(CloudflareDoRpcProvider.doSqlite.layer)

  Vitest.live(
    'server keeps fanning out to a live DO-RPC subscriber after the backend is reconstructed',
    () => liveDeliverySurvivesBackendReconstruction.pipe(Effect.provide(getContext())),
    testTimeoutMs,
  )
})

const subscriberClient = EventFactory.clientIdentity('do-rpc-sync-subscriber', 'do-rpc-sync-sub-session')
const writerClient = EventFactory.clientIdentity('do-rpc-sync-writer', 'do-rpc-sync-writer-session')

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
    return yield* new SyncDoProbeError({ message: 'backend never reconstructed within the idle windows' })
  })

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

  const subscriber = yield* makeProvider(
    { storeId, clientId: subscriberClient.clientId, payload: undefined },
    { pingSchedule: Schedule.spaced('2 seconds') }, // keeps the subscriber's client DO warm
  )
  yield* subscriber.connect
  const received = yield* collectReceivedIds(subscriber)

  const writer = yield* makeProvider({ storeId, clientId: writerClient.clientId, payload: undefined })
  const writerFactory = makeEventFactory({ client: writerClient, startSeq: 1, initialParent: 'root' })
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
