import type { SyncBackend } from '@livestore/common'
import { EventFactory } from '@livestore/common/testing'
import { nanoid } from '@livestore/livestore'
import { events } from '@livestore/livestore/internal/testing-utils'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import {
  type Context,
  Data,
  Duration,
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

import { SyncProviderImpl, type SyncProviderLayer } from './types.ts'

export type RuntimeServices = SyncProviderImpl | HttpClient.HttpClient | KeyValueStore.KeyValueStore

export class SyncDoProbeError extends Data.TaggedError('SyncDoProbeError')<{ message: string }> {}

export const makeEventFactory = EventFactory.makeFactory(events)

/**
 * Builds the sync-provider runtime and registers its `beforeAll`/`afterAll` lifecycle in the
 * calling suite. Returns a getter that yields the runtime context once `beforeAll` has run.
 */
export const setupProviderRuntime = (layer: SyncProviderLayer) => {
  let runtime: ManagedRuntime.ManagedRuntime<RuntimeServices, never>
  let context: Context.Context<RuntimeServices>

  Vitest.beforeAll(async () => {
    runtime = ManagedRuntime.make(
      layer.pipe(Layer.provideMerge(FetchHttpClient.layer), Layer.provideMerge(KeyValueStore.layerMemory), Layer.orDie),
    )
    context = await runtime.context()
  })

  Vitest.afterAll(async () => await runtime.dispose())

  return () => context
}

export const syncProvider = Effect.gen(function* () {
  const { makeProvider, providerSpecific } = yield* SyncProviderImpl
  const { port } = providerSpecific
  if (port === undefined) {
    return yield* Effect.die('sync provider did not expose a dev server port')
  }
  return { makeProvider, port }
})

/** Probes the sync backend DO; a changed `instanceId` means it was evicted and rebuilt. */
export const probeSyncDo = ({ port, storeId }: { port: number; storeId: string }) =>
  Effect.promise(() =>
    fetch(`http://localhost:${port}/instance/sync?storeId=${storeId}`).then((res) => res.json()),
  ).pipe(Effect.map((json) => json as { instanceId: string; webSocketCount: number }))

/** Forks a scoped live pull that records every delivered event id into the returned array. */
export const collectReceivedIds = (backend: SyncBackend.SyncBackend) =>
  Effect.gen(function* () {
    const received: string[] = []
    yield* backend.pull(Option.none(), { live: true }).pipe(
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
    return received
  })

/** Polls `received` until `id` arrives, failing if it never lands within `timeout`. */
export const awaitDelivery = (
  { received, id }: { received: ReadonlyArray<string>; id: string },
  timeout: Duration.Input = '10 seconds',
) =>
  Effect.sync(() => received.includes(id)).pipe(
    Effect.flatMap((delivered) =>
      delivered === true ? Effect.void : Effect.fail(new SyncDoProbeError({ message: `not yet delivered: ${id}` })),
    ),
    Effect.retry(Schedule.spaced('300 millis')),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        new SyncDoProbeError({
          message: `live subscriber never received "${id}" within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
        }),
    }),
  )

/** Warm control: an actively probed DO must keep the same `instanceId` across the idle window. */
export const staysResidentWhileWarm = ({
  idleWindow,
  storeIdPrefix,
}: {
  idleWindow: Duration.Input
  storeIdPrefix: string
}) =>
  Effect.gen(function* () {
    const { port } = yield* syncProvider
    const storeId = `${storeIdPrefix}-${nanoid()}`

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
