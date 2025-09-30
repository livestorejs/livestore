import { makePersistedAdapter } from '@livestore/adapter-web'
import LiveStoreSharedWorker from '@livestore/adapter-web/shared-worker?sharedworker'
import type { BootStatus } from '@livestore/common'
import { Effect, Logger, LogLevel, Queue, Schema } from '@livestore/utils/effect'

import { ResultDuplicateSessionId } from './bridge.ts'
import LiveStoreWorker from './livestore.worker.ts?worker'
import { schema } from './schema.ts'

export const testDuplicateTab = () =>
  Effect.gen(function* () {
    const storeId = `duplicate-tab-${crypto.randomUUID()}`
    const sessionStorageKey = `livestore:sessionId:${storeId}`
    const workerNames: Array<{ tab: 'first' | 'second'; name: string }> = []

    const makeAdapterForTab = (tab: 'first' | 'second') =>
      makePersistedAdapter({
        storage: { type: 'opfs' },
        sharedWorker: LiveStoreSharedWorker,
        worker: (options) => {
          workerNames.push({ tab, name: options.name })
          return new LiveStoreWorker(options)
        },
      })

    const bootStatusQueueFirst = yield* Queue.unbounded<BootStatus>()
    const bootStatusQueueSecond = yield* Queue.unbounded<BootStatus>()

    yield* Effect.addFinalizer(() => Queue.shutdown(bootStatusQueueSecond))
    yield* Effect.addFinalizer(() => Queue.shutdown(bootStatusQueueFirst))

    if (typeof sessionStorage !== 'undefined') {
      yield* Effect.addFinalizer(() => Effect.sync(() => sessionStorage.removeItem(sessionStorageKey)))
    }

    const firstSession = yield* makeAdapterForTab('first')({
      schema,
      storeId,
      devtoolsEnabled: false,
      bootStatusQueue: bootStatusQueueFirst,
      shutdown: () => Effect.void,
      connectDevtoolsToStore: () => Effect.void,
      debugInstanceId: 'duplicate-tab-first',
      syncPayload: undefined,
    })

    const firstSessionId = firstSession.sessionId
    const sessionStorageBeforeSecond =
      typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(sessionStorageKey)

    const secondSession = yield* makeAdapterForTab('second')({
      schema,
      storeId,
      devtoolsEnabled: false,
      bootStatusQueue: bootStatusQueueSecond,
      shutdown: () => Effect.void,
      connectDevtoolsToStore: () => Effect.void,
      debugInstanceId: 'duplicate-tab-second',
      syncPayload: undefined,
    })

    const secondSessionId = secondSession.sessionId
    const sessionStorageAfterSecond =
      typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(sessionStorageKey)

    return {
      firstSessionId,
      secondSessionId,
      sessionStorageBeforeSecond,
      sessionStorageAfterSecond,
      workerNames,
    }
  }).pipe(
    Effect.tapCauseLogPretty,
    Effect.exit,
    Effect.tapSync((exit) => {
      window.postMessage(Schema.encodeSync(ResultDuplicateSessionId)(ResultDuplicateSessionId.make({ exit })))
    }),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.pretty),
    Effect.scoped,
    Effect.runPromise,
  )
