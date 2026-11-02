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

const describeDoRpcDo = Vitest.describe.skipIf(isProviderSelected('cf-do-rpc-do') === false)

describeDoRpcDo(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO-RPC client reconstruction`, () => {
  const getContext = setupProviderRuntime(CloudflareDoRpcProvider.doSqlite.layer)

  Vitest.live(
    'a reconstructed DO-RPC client store recovers the reverse-RPC update via re-boot and catch-up',
    () => storeRecoversLiveUpdateAfterClientReconstruction.pipe(Effect.provide(getContext())),
    testTimeoutMs,
  )
})

const writerClient = EventFactory.clientIdentity('do-rpc-client-writer', 'do-rpc-client-writer-session')
const catchupClient = EventFactory.clientIdentity('do-rpc-client-catchup', 'do-rpc-client-catchup-session')

type StoreProbe = { instanceId: string; todoIds: ReadonlyArray<string> }

/** Triggers the initial store boot inside StoreClientDo (a livePull subscriber). */
const bootStoreClient = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/store/boot?storeId=${storeId}`, { method: 'POST' }))

/** Reads the client's materialized todos via the store-probe endpoint. */
const probeStoreClient = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() => fetch(`http://localhost:${port}/store/probe?storeId=${storeId}`).then((res) => res.json())).pipe(
    Effect.map((json) => json as StoreProbe),
  )

/** Polls the store probe until `id` lands in the materialized todos (i.e. it was applied). */
const awaitPersisted = (
  { port, storeId, id }: { port: number; storeId: string; id: string },
  timeout: Duration.Input = '10 seconds',
) =>
  probeStoreClient({ port, storeId }).pipe(
    Effect.flatMap((probe) =>
      probe.todoIds.includes(id) === true
        ? Effect.void
        : Effect.fail(new SyncDoProbeError({ message: `not yet persisted: ${id}` })),
    ),
    Effect.retry(Schedule.spaced('300 millis')),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => new SyncDoProbeError({ message: `store never persisted "${id}"` }),
    }),
  )

// Idles the CLIENT DO into a real reconstruction while keeping the SERVER warm: probing the sync DO
// every few seconds never touches the client DO, so only the client's idle timer runs out.
const awaitClientReconstruction = ({
  port,
  storeId,
  baselineId,
}: {
  port: number
  storeId: string
  baselineId: string
}) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 3; attempt++) {
      yield* probeSyncDo({ port, storeId }).pipe(
        Effect.delay('3 seconds'),
        Effect.forever,
        Effect.timeout(idleWindow),
        Effect.ignore,
      )
      const probe = yield* probeStoreClient({ port, storeId })
      if (probe.instanceId !== baselineId) return probe
    }
    return yield* new SyncDoProbeError({ message: 'client DO never reconstructed within the idle windows' })
  })

// A reconstructed DO-RPC client store recovers a live update pushed while it was gone. We observe the
// client's OWN materialized state via the store API — heal-free — so the recovery is real, not a probe artifact.
//
//   writer ──push──►  server  ──reverse-RPC (carries storeId)──►  StoreClientDo (real subscriber store, livePull)
//                     (subscription persisted in the server's KV)
//
//   1. boot + warm          push "before"  ──►  reverse-RPC applied + persisted to eventlog             ✓
//   2. idle the CLIENT ~14s  ──►  it evicts & rebuilds  ──►  its per-instance pull-routing map = { }
//      (the server is probed every 3s, so only the client sleeps)
//   3. rebuilt              push "after"   ──►  the reverse-RPC carries the storeId, so the store-less
//      wake re-boots the store; its catch-up pull recovers "after" ──►  applied + persisted             ✓
//
// Contract: the reconstructed client's materialized todos gain BOTH "before-reconstruct" and
// "after-reconstruct" (the pre-recovery version asserted the drop via `not.toContain`).
const storeRecoversLiveUpdateAfterClientReconstruction = Effect.gen(function* () {
  const { makeProvider, port } = yield* syncProvider
  const storeId = `do-rpc-client-reconstruction-${nanoid()}`

  // The subscriber is a real store inside StoreClientDo. No pingSchedule keeps it idle-evictable.
  yield* bootStoreClient({ port, storeId })

  const writer = yield* makeProvider({ storeId, clientId: writerClient.clientId, payload: undefined })
  const writerFactory = makeEventFactory({ client: writerClient, startSeq: 1, initialParent: 'root' })
  yield* writer.connect

  yield* Effect.sleep('1 second')
  yield* writer.push([writerFactory.todoCreated.next({ id: 'before-reconstruct', text: 'before', completed: false })])

  // Live reverse-RPC applies + materializes it: proves the store probe sees applied events (non-vacuous).
  yield* awaitPersisted({ port, storeId, id: 'before-reconstruct' })

  const clientBefore = yield* probeStoreClient({ port, storeId })
  const serverBefore = yield* probeSyncDo({ port, storeId })

  const clientAfter = yield* awaitClientReconstruction({ port, storeId, baselineId: clientBefore.instanceId })
  const serverAfter = yield* probeSyncDo({ port, storeId })

  expect(clientAfter.instanceId).not.toBe(clientBefore.instanceId)
  expect(serverAfter.instanceId).toBe(serverBefore.instanceId)

  yield* writer.push([writerFactory.todoCreated.next({ id: 'after-reconstruct', text: 'after', completed: false })])

  // A brand-new subscriber still receives "after-reconstruct" from the server: proof the push actually
  // reached the backend, so the recovery below is the reconstructed client catching up — not a vacuous pass.
  const catchup = yield* makeProvider({ storeId, clientId: catchupClient.clientId, payload: undefined })
  yield* catchup.connect
  const catchupReceived = yield* collectReceivedIds(catchup)
  yield* awaitDelivery({ received: catchupReceived, id: 'after-reconstruct' })

  // Recovery: the store-less reverse-RPC wake re-boots the store, which catches up — so "after" now
  // materializes on the reconstructed client too.
  yield* awaitPersisted({ port, storeId, id: 'after-reconstruct' })
  const finalProbe = yield* probeStoreClient({ port, storeId })
  expect(finalProbe.todoIds).toContain('before-reconstruct')
  expect(finalProbe.todoIds).toContain('after-reconstruct')
})
