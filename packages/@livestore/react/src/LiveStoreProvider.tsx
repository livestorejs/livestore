import type { Adapter, BootStatus, IntentionalShutdownCause, MigrationsReport } from '@livestore/common'
import { provideOtel, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type {
  CreateStoreOptions,
  LiveStoreContext as StoreContext_,
  OtelOptions,
  ShutdownDeferred,
  Store,
} from '@livestore/livestore'
import { createStore, StoreInterrupted } from '@livestore/livestore'
import { errorToString, LS_DEV } from '@livestore/utils'
import type { OtelTracer } from '@livestore/utils/effect'
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  identity,
  Logger,
  LogLevel,
  Schema,
  Scope,
  TaskTracing,
} from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.js'

export interface LiveStoreProviderProps {
  schema: LiveStoreSchema
  /**
   * The `storeId` can be used to isolate multiple stores from each other.
   * So it can be useful for multi-tenancy scenarios.
   *
   * The `storeId` is also used for persistence.
   *
   * Make sure to also configure `storeId` in LiveStore Devtools (e.g. in Vite plugin).
   *
   * @default 'default'
   */
  storeId?: string
  boot?: (
    store: Store<LiveStoreSchema>,
    ctx: { migrationsReport: MigrationsReport; parentSpan: otel.Span },
  ) => void | Promise<void> | Effect.Effect<void, unknown, OtelTracer.OtelTracer>
  otelOptions?: Partial<OtelOptions>
  renderLoading: (status: BootStatus) => ReactElement
  renderError?: (error: UnexpectedError | unknown) => ReactElement
  renderShutdown?: (cause: IntentionalShutdownCause | StoreInterrupted) => ReactElement
  adapter: Adapter
  /**
   * In order for LiveStore to apply multiple mutations in a single render,
   * you need to pass the `batchUpdates` function from either `react-dom` or `react-native`.
   *
   * ```ts
   * // With React DOM
   * import { unstable_batchedUpdates as batchUpdates } from 'react-dom'
   *
   * // With React Native
   * import { unstable_batchedUpdates as batchUpdates } from 'react-native'
   * ```
   */
  batchUpdates: (run: () => void) => void
  disableDevtools?: boolean
  signal?: AbortSignal
  /**
   * Currently only used in the web adapter:
   * If true, registers a beforeunload event listener to confirm unsaved changes.
   *
   * @default true
   */
  confirmUnsavedChanges?: boolean
  /**
   * Payload that will be passed to the sync backend when connecting
   *
   * @default undefined
   */
  syncPayload?: Schema.JsonValue
}

const defaultRenderError = (error: UnexpectedError | unknown) => (
  <>{Schema.is(UnexpectedError)(error) ? error.toString() : errorToString(error)}</>
)
const defaultRenderShutdown = (cause: IntentionalShutdownCause | StoreInterrupted) => {
  const reason =
    cause._tag === 'LiveStore.StoreInterrupted'
      ? `interrupted due to: ${cause.reason}`
      : cause.reason === 'devtools-import'
        ? 'devtools import'
        : cause.reason === 'devtools-reset'
          ? 'devtools reset'
          : cause.reason === 'manual'
            ? 'manual shutdown'
            : 'unknown reason'

  return <>LiveStore Shutdown due to {reason}</>
}

export const LiveStoreProvider = ({
  renderLoading,
  renderError = defaultRenderError,
  renderShutdown = defaultRenderShutdown,
  otelOptions,
  children,
  schema,
  storeId = 'default',
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
  confirmUnsavedChanges = true,
  syncPayload,
}: LiveStoreProviderProps & { children?: ReactNode }): React.ReactElement => {
  const storeCtx = useCreateStore({
    storeId,
    schema,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    signal,
    confirmUnsavedChanges,
    syncPayload,
  })

  if (storeCtx.stage === 'error') {
    return renderError(storeCtx.error)
  }

  if (storeCtx.stage === 'shutdown') {
    return renderShutdown(storeCtx.cause)
  }

  if (storeCtx.stage !== 'running') {
    return renderLoading(storeCtx)
  }

  globalThis.__debugLiveStore ??= {}
  if (Object.keys(globalThis.__debugLiveStore).length === 0) {
    globalThis.__debugLiveStore['_'] = storeCtx.store
  }
  globalThis.__debugLiveStore[storeId] = storeCtx.store

  return <LiveStoreContext.Provider value={storeCtx}>{children}</LiveStoreContext.Provider>
}

type SchemaKey = string
const semaphoreMap = new Map<SchemaKey, Effect.Semaphore>()

const withSemaphore = (storeId: SchemaKey) => {
  let semaphore = semaphoreMap.get(storeId)
  if (!semaphore) {
    semaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)
    semaphoreMap.set(storeId, semaphore)
  }
  return semaphore.withPermits(1)
}

const useCreateStore = ({
  schema,
  storeId,
  otelOptions,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
  context,
  params,
  confirmUnsavedChanges,
  syncPayload,
}: CreateStoreOptions<LiveStoreSchema> & {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}) => {
  const [_, rerender] = React.useState(0)
  const ctxValueRef = React.useRef<{
    value: StoreContext_ | BootStatus
    componentScope: Scope.CloseableScope | undefined
    shutdownDeferred: ShutdownDeferred | undefined
    counter: number
  }>({
    value: { stage: 'loading' },
    componentScope: undefined,
    shutdownDeferred: undefined,
    counter: 0,
  })

  // console.debug(`useCreateStore (${ctxValueRef.current.counter})`, ctxValueRef.current.value.stage)

  const inputPropsCacheRef = React.useRef({
    schema,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    signal,
    context,
    params,
    confirmUnsavedChanges,
    syncPayload,
  })

  const interrupt = (
    componentScope: Scope.CloseableScope,
    shutdownDeferred: ShutdownDeferred,
    error: StoreInterrupted,
  ) =>
    Effect.gen(function* () {
      // console.log('[@livestore/livestore/react] interupting', error)
      yield* Scope.close(componentScope, Exit.fail(error))
      yield* Deferred.fail(shutdownDeferred, error)
    }).pipe(
      Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] interupting', cause)),
      Effect.runFork,
    )

  if (
    inputPropsCacheRef.current.schema !== schema ||
    inputPropsCacheRef.current.otelOptions !== otelOptions ||
    inputPropsCacheRef.current.boot !== boot ||
    inputPropsCacheRef.current.adapter !== adapter ||
    inputPropsCacheRef.current.batchUpdates !== batchUpdates ||
    inputPropsCacheRef.current.disableDevtools !== disableDevtools ||
    inputPropsCacheRef.current.signal !== signal ||
    inputPropsCacheRef.current.context !== context ||
    inputPropsCacheRef.current.params !== params ||
    inputPropsCacheRef.current.confirmUnsavedChanges !== confirmUnsavedChanges ||
    inputPropsCacheRef.current.syncPayload !== syncPayload
  ) {
    inputPropsCacheRef.current = {
      schema,
      otelOptions,
      boot,
      adapter,
      batchUpdates,
      disableDevtools,
      signal,
      context,
      params,
      confirmUnsavedChanges,
      syncPayload,
    }
    if (ctxValueRef.current.componentScope !== undefined && ctxValueRef.current.shutdownDeferred !== undefined) {
      interrupt(
        ctxValueRef.current.componentScope,
        ctxValueRef.current.shutdownDeferred,
        new StoreInterrupted({ reason: 're-rendering due to changed input props' }),
      )
      ctxValueRef.current.componentScope = undefined
      ctxValueRef.current.shutdownDeferred = undefined
    }
    ctxValueRef.current = {
      value: { stage: 'loading' },
      componentScope: undefined,
      shutdownDeferred: undefined,
      counter: ctxValueRef.current.counter + 1,
    }
  }

  React.useEffect(() => {
    const counter = ctxValueRef.current.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (ctxValueRef.current.counter !== counter) return
      ctxValueRef.current.value = value
      rerender((c) => c + 1)
    }

    signal?.addEventListener('abort', () => {
      if (
        ctxValueRef.current.componentScope !== undefined &&
        ctxValueRef.current.shutdownDeferred !== undefined &&
        ctxValueRef.current.counter === counter
      ) {
        interrupt(
          ctxValueRef.current.componentScope,
          ctxValueRef.current.shutdownDeferred,
          new StoreInterrupted({ reason: 'Aborted via provided AbortController' }),
        )
        ctxValueRef.current.componentScope = undefined
        ctxValueRef.current.shutdownDeferred = undefined
      }
    })

    Effect.gen(function* () {
      const componentScope = yield* Scope.make()
      const shutdownDeferred = yield* Deferred.make<
        void,
        UnexpectedError | IntentionalShutdownCause | StoreInterrupted
      >()

      ctxValueRef.current.componentScope = componentScope
      ctxValueRef.current.shutdownDeferred = shutdownDeferred

      yield* Effect.gen(function* () {
        const store = yield* createStore({
          schema,
          storeId,
          boot,
          adapter,
          batchUpdates,
          disableDevtools,
          shutdownDeferred,
          context,
          params,
          confirmUnsavedChanges,
          syncPayload,
          onBootStatus: (status) => {
            if (ctxValueRef.current.value.stage === 'running' || ctxValueRef.current.value.stage === 'error') return
            // NOTE sometimes when status come in in rapid succession, only the last value will be rendered by React
            setContextValue(status)
          },
        }).pipe(Effect.tapErrorCause((cause) => Deferred.failCause(shutdownDeferred, cause)))

        setContextValue({ stage: 'running', store })
      }).pipe(Scope.extend(componentScope), Effect.forkIn(componentScope))

      const shutdownContext = (cause: IntentionalShutdownCause | StoreInterrupted) =>
        Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

      yield* Deferred.await(shutdownDeferred).pipe(
        Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] shutdown', Cause.pretty(cause))),
        Effect.catchTag('LiveStore.IntentionalShutdownCause', (cause) => shutdownContext(cause)),
        Effect.catchTag('LiveStore.StoreInterrupted', (cause) => shutdownContext(cause)),
        Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
        Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
        Effect.exit,
      )
    }).pipe(
      Effect.scoped,
      // NOTE we're running the code above in a semaphore to make sure a previous store is always fully
      // shutdown before a new one is created - especially when shutdown logic is async. You can't trust `React.useEffect`.
      // Thank you to Mattia Manzati for this idea.
      withSemaphore(storeId),
      Effect.withSpan('@livestore/react:useCreateStore'),
      LS_DEV ? TaskTracing.withAsyncTaggingTracing((name: string) => (console as any).createTask(name)) : identity,
      provideOtel({ parentSpanContext: otelOptions?.rootSpanContext, otelTracer: otelOptions?.tracer }),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread: 'window' }),
      Effect.provide(Logger.prettyWithThread('window')),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runFork,
    )

    return () => {
      if (ctxValueRef.current.componentScope !== undefined && ctxValueRef.current.shutdownDeferred !== undefined) {
        interrupt(
          ctxValueRef.current.componentScope,
          ctxValueRef.current.shutdownDeferred,
          new StoreInterrupted({ reason: 'unmounting component' }),
        )
        ctxValueRef.current.componentScope = undefined
        ctxValueRef.current.shutdownDeferred = undefined
      }
    }
  }, [
    schema,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    signal,
    storeId,
    context,
    params,
    confirmUnsavedChanges,
    syncPayload,
  ])

  return ctxValueRef.current.value
}
