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
  SyncDoProbeError,
  syncProvider,
} from './do-idle-helpers.ts'
import * as CloudflareWsProvider from './providers/cloudflare-ws.ts'
import { isProviderSelected } from './providers/registry.ts'

const idleWindow: Duration.Input = '20 seconds' // workerd evicts somewhere between 9s and 11s idle

// Selected by provider key, not by suite title, so renaming this suite cannot drop it from CI.
const describeWsDo = Vitest.describe.skipIf(isProviderSelected('cf-ws-do') === false)

describeWsDo(`${CloudflareWsProvider.doSqlite.name} sync provider — DO hibernation`, () => {
  const getContext = setupProviderRuntime(CloudflareWsProvider.doSqlite.layer)

  Vitest.live('an idle WS client lets the DO hibernate, and a warm DO stays resident', () =>
    Effect.gen(function* () {
      const observed = yield* Effect.all(
        {
          idle: hibernatesWhenIdle({ livePull: false }),
          livePull: hibernatesWhenIdle({ livePull: true }),
          warmControl: staysResidentWhileWarm({ idleWindow, storeIdPrefix: 'hibernation-warm' }),
        },
        { concurrency: 'unbounded' },
      )

      expect(observed).toEqual({ idle: true, livePull: true, warmControl: false })
    }).pipe(Effect.provide(getContext())),
  )
})

const eventClient = EventFactory.clientIdentity('hibernation-client', 'hibernation-session')

const probeWithOpenSocket = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.gen(function* () {
    const probe = yield* probeSyncDo({ port, storeId })
    if (probe.webSocketCount === 0) {
      return yield* new SyncDoProbeError({
        message: `no websocket attached to ${storeId}; hibernation claim would be vacuous`,
      })
    }
    return probe.instanceId
  })

const hibernatesWhenIdle = ({ livePull }: { livePull: boolean }) =>
  Effect.gen(function* () {
    const { makeProvider, port } = yield* syncProvider
    const storeId = `hibernation-${livePull === true ? 'live-pull' : 'idle'}-${nanoid()}`
    const syncBackend = yield* makeProvider({ storeId, clientId: eventClient.clientId, payload: undefined })
    const factory = makeEventFactory({ client: eventClient, startSeq: 1, initialParent: 'root' })

    yield* syncBackend.connect

    const received = livePull === true ? yield* collectReceivedIds(syncBackend) : []

    if (livePull === true) {
      // A dead pull leaves no park, so "it hibernated" would pass for the wrong reason.
      yield* Effect.sleep('1 second')
      yield* syncBackend.push([factory.todoCreated.next({ id: 'before-idle', text: 'before', completed: false })])
      yield* awaitDelivery({ received, id: 'before-idle' })
    }

    const before = yield* probeWithOpenSocket({ port, storeId })
    yield* Effect.sleep(idleWindow)
    const after = yield* probeWithOpenSocket({ port, storeId })

    if (livePull === true) {
      yield* syncBackend.push([factory.todoCreated.next({ id: 'after-idle', text: 'after', completed: false })])
      yield* awaitDelivery({ received, id: 'after-idle' })
    }

    return before !== after
  })
