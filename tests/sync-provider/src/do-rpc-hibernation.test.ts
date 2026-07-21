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
import { SyncProviderImpl } from './types.ts'

const idleWindow: Duration.Input = '20 seconds' // workerd evicts somewhere between 9s and 11s idle

type RuntimeServices = SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore

// CI cells select by title (see scripts/src/commands/test-commands.ts); renaming this stops it running anywhere.
Vitest.describe(`${CloudflareDoRpcProvider.doSqlite.name} sync provider — DO hibernation`, () => {
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

  Vitest.live('an idle DO-RPC live pull still lets the sync DO hibernate, and a warm DO stays resident', () =>
    Effect.gen(function* () {
      const observed = yield* Effect.all(
        { livePull: hibernatesWhileIdleOverDoRpc, warmControl: staysResidentWhileWarm },
        { concurrency: 'unbounded' },
      )

      expect(observed).toEqual({ livePull: true, warmControl: false })
    }).pipe(Effect.provide(runtimeContext)),
  )
})

class HibernationProbeError extends Data.TaggedError('HibernationProbeError')<{ message: string }> {}

const syncProvider = Effect.gen(function* () {
  const { makeProvider, providerSpecific } = yield* SyncProviderImpl
  const { port } = providerSpecific
  if (port === undefined) {
    return yield* Effect.die('sync provider did not expose a dev server port')
  }
  return { makeProvider, port }
})

const eventClient = EventFactory.clientIdentity('do-rpc-hibernation-client', 'do-rpc-hibernation-session')
const makeFactory = EventFactory.makeFactory(events)

const probeSyncDo = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() =>
    fetch(`http://localhost:${port}/instance/sync?storeId=${storeId}`).then((res) => res.json()),
  ).pipe(Effect.map((json) => json as { instanceId: string; webSocketCount: number }))

const awaitDelivery = ({ received, id }: { received: ReadonlyArray<string>; id: string }) =>
  Effect.sync(() => received.includes(id)).pipe(
    Effect.flatMap((delivered) =>
      delivered === true ? Effect.void : Effect.fail(new HibernationProbeError({ message: `never delivered: ${id}` })),
    ),
    Effect.retry(Schedule.spaced('300 millis')),
    Effect.timeout('10 seconds'),
  )

const hibernatesWhileIdleOverDoRpc = Effect.gen(function* () {
  const { makeProvider, port } = yield* syncProvider
  const storeId = `do-rpc-hibernation-${nanoid()}`
  const syncBackend = yield* makeProvider({ storeId, clientId: eventClient.clientId, payload: undefined })
  const factory = makeFactory({ client: eventClient, startSeq: 1, initialParent: 'root' })
  const received: string[] = []

  yield* syncBackend.connect
  yield* syncBackend.pull(Option.none(), { live: true }).pipe(
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

  // DO RPC keeps no socket, so this delivery is the only proof the live pull is really parked before we idle.
  yield* Effect.sleep('1 second')
  yield* syncBackend.push([factory.todoCreated.next({ id: 'before-idle', text: 'before', completed: false })])
  yield* awaitDelivery({ received, id: 'before-idle' })

  const before = yield* probeSyncDo({ port, storeId })
  yield* Effect.sleep(idleWindow)
  const after = yield* probeSyncDo({ port, storeId })

  return before.instanceId !== after.instanceId
})

const staysResidentWhileWarm = Effect.gen(function* () {
  const { port } = yield* syncProvider
  const storeId = `do-rpc-hibernation-warm-${nanoid()}`

  const before = yield* probeSyncDo({ port, storeId })
  yield* probeSyncDo({ port, storeId }).pipe(
    Effect.delay('3 seconds'),
    Effect.forever,
    Effect.timeout(idleWindow),
    Effect.ignore,
  )
  const after = yield* probeSyncDo({ port, storeId })

  return before.instanceId !== after.instanceId
})
