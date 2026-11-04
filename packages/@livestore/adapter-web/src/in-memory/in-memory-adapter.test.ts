import { live } from '@effect/vitest'
import { expect } from 'vitest'

import { Deferred, Effect, Exit, Layer, RpcGroup, RpcServer, Scope } from '@livestore/utils/effect'
import { BrowserWorkerRunner } from '@livestore/utils/effect/browser'

import { LeaderWorkerInnerExport } from '../web-worker/common/worker-schema.ts'
import { makeSharedWorkerClient } from './in-memory-adapter.ts'

live('keeps the in-memory shared worker protocol alive until the adapter scope closes', () =>
  Effect.gen(function* () {
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        channel.port1.close()
        channel.port2.close()
      }),
    )
    const workerClosed = yield* Deferred.make<void>()
    channel.port2.addEventListener('close', () => Deferred.doneUnsafe(workerClosed, Exit.void), { once: true })

    // Exercise the real worker protocol with a transferable response after client construction.
    const snapshot = new Uint8Array([1, 2, 3])
    const rpcs = RpcGroup.make(LeaderWorkerInnerExport)
    // A runner exits its owning fiber on disconnect, as it would in a separate worker.
    yield* RpcServer.layer(rpcs).pipe(
      Layer.provide(rpcs.toLayer({ Export: () => Effect.succeed(snapshot) })),
      Layer.provide(RpcServer.layerProtocolWorkerRunner),
      Layer.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
      Layer.launch,
      Effect.forkScoped,
    )

    class SharedWorkerEndpoint extends EventTarget {
      readonly port = channel.port1
      onerror: SharedWorker['onerror'] = null
    }

    const adapterScope = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(adapterScope, exit))
    const client = yield* makeSharedWorkerClient(new SharedWorkerEndpoint()).pipe(Scope.provide(adapterScope))
    expect(yield* client.Export({})).toEqual(new Uint8Array([1, 2, 3]))
    expect(yield* Deferred.isDone(workerClosed)).toBe(false)

    yield* Scope.close(adapterScope, Exit.void)
    yield* Deferred.await(workerClosed)
    expect(yield* Deferred.isDone(workerClosed)).toBe(true)
  }),
)
