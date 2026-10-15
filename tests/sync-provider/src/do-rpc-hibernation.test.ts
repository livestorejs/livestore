import { expect } from 'vitest'

import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { type Duration, Effect } from '@livestore/utils/effect'

import {
  awaitDelivery,
  collectReceivedIds,
  makeEventFactory,
  probeSyncDo,
  setupProviderRuntime,
  staysResidentWhileWarm,
  syncProvider,
} from './do-idle-helpers.ts'
import * as CloudflareDoRpcProvider from './providers/cloudflare-do-rpc.ts'
import { isProviderSelected } from './providers/registry.ts'

const idleWindow: Duration.Input = '20 seconds' // workerd evicts somewhere between 9s and 11s idle

// Selected by provider key, not by suite title, so renaming this suite cannot drop it from CI.
const describeDoRpcDo = Vitest.describe.skipIf(isProviderSelected('cf-do-rpc-do') === false)

describeDoRpcDo(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO hibernation`, () => {
  const getContext = setupProviderRuntime(CloudflareDoRpcProvider.doSqlite.layer)

  Vitest.live('an idle DO-RPC live pull still lets the sync DO hibernate, and a warm DO stays resident', () =>
    Effect.gen(function* () {
      const observed = yield* Effect.all(
        {
          livePull: hibernatesWhileIdleOverDoRpc,
          warmControl: staysResidentWhileWarm({ idleWindow, storeIdPrefix: 'do-rpc-hibernation-warm' }),
        },
        { concurrency: 'unbounded' },
      )

      expect(observed).toEqual({ livePull: true, warmControl: false })
    }).pipe(Effect.provide(getContext())),
  )
})

const eventClient = EventFactory.clientIdentity('do-rpc-hibernation-client', 'do-rpc-hibernation-session')

const hibernatesWhileIdleOverDoRpc = Effect.gen(function* () {
  const { makeProvider, port } = yield* syncProvider
  const storeId = `do-rpc-hibernation-${nanoid()}`
  const syncBackend = yield* makeProvider({ storeId, clientId: eventClient.clientId, payload: undefined })
  const factory = makeEventFactory({ client: eventClient, startSeq: 1, initialParent: 'root' })

  yield* syncBackend.connect
  const received = yield* collectReceivedIds(syncBackend)

  // DO RPC keeps no socket, so this delivery is the only proof the live pull is really parked before we idle.
  yield* Effect.sleep('1 second')
  yield* syncBackend.push([factory.todoCreated.next({ id: 'before-idle', text: 'before', completed: false })])
  yield* awaitDelivery({ received, id: 'before-idle' })

  const before = yield* probeSyncDo({ port, storeId })
  yield* Effect.sleep(idleWindow)
  const after = yield* probeSyncDo({ port, storeId })

  return before.instanceId !== after.instanceId
})
