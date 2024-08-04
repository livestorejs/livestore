import { UnexpectedError } from '@livestore/common'
import type { WorkerRunner } from '@livestore/utils/effect'
import { Deferred, Effect } from '@livestore/utils/effect'

import type * as WorkerSchema from './worker-schema.js'

export const makeDevtoolsWebBridge = Effect.gen(function* () {
  type WebBridgeId = string
  const devtoolsPortDeferreds = new Map<WebBridgeId, Deferred.Deferred<MessagePort>>()
  // @ts-expect-error Only for debugging
  globalThis.__debugDevtoolsPortDeferreds = devtoolsPortDeferreds

  const reset = Effect.gen(function* () {
    devtoolsPortDeferreds.clear()
  })

  const handlers: WorkerRunner.SerializedRunner.Handlers<
    WorkerSchema.SharedWorker.DevtoolsWebBridgeOfferPort | WorkerSchema.SharedWorker.DevtoolsWebBridgeWaitForPort
  > = {
    DevtoolsWebBridgeOfferPort: ({ port, webBridgeId }) =>
      Effect.gen(function* () {
        console.log('OfferDevtoolsPort', webBridgeId, devtoolsPortDeferreds.has(webBridgeId))

        const existingDeferred = devtoolsPortDeferreds.get(webBridgeId)
        if (existingDeferred === undefined) {
          const deferred = yield* Deferred.make<MessagePort>()
          yield* Deferred.succeed(deferred, port)
          devtoolsPortDeferreds.set(webBridgeId, deferred)
        } else {
          yield* Deferred.succeed(existingDeferred, port)
        }
      }).pipe(Effect.withSpan('@livestore/web:shared-worker:offerDevtoolsPort'), UnexpectedError.mapToUnexpectedError),

    DevtoolsWebBridgeWaitForPort: ({ webBridgeId }) =>
      Effect.gen(function* () {
        console.log('WaitForDevtoolsPort', webBridgeId, devtoolsPortDeferreds.has(webBridgeId))

        if (!devtoolsPortDeferreds.has(webBridgeId)) {
          const deferred = yield* Deferred.make<MessagePort>()
          devtoolsPortDeferreds.set(webBridgeId, deferred)
        }

        const deferred = devtoolsPortDeferreds.get(webBridgeId)! as Deferred.Deferred<MessagePort>
        const port = yield* Deferred.await(deferred)

        devtoolsPortDeferreds.delete(webBridgeId)

        return { port }
      }).pipe(
        Effect.withSpan('@livestore/web:shared-worker:waitForDevtoolsPort'),
        UnexpectedError.mapToUnexpectedError,
      ),
  }

  return { handlers, reset }
})
