import type { Adapter, BootStatus, IntentionalShutdownCause, MigrationsReport, SyncError } from '@livestore/common'
import { provideOtel, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type {
  CreateStoreOptions,
  OtelOptions,
  ShutdownDeferred,
  Store,
  LiveStoreContext as StoreContext_,
} from '@livestore/livestore'
import { createStore, makeShutdownDeferred, StoreInterrupted } from '@livestore/livestore'
import { errorToString, IS_REACT_NATIVE, LS_DEV } from '@livestore/utils'
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
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.ts'

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
  renderLoading?: (status: BootStatus) => React.ReactNode
  renderError?: (error: UnexpectedError | unknown) => React.ReactNode
  renderShutdown?: (cause: IntentionalShutdownCause | StoreInterrupted | SyncError) => React.ReactNode
  adapter: Adapter
  /**
   * In order for LiveStore to apply multiple events in a single render,
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
  debug?: {
    instanceId?: string
  }
}

const defaultRenderError = (error: UnexpectedError | unknown) =>
  IS_REACT_NATIVE ? null : Schema.is(UnexpectedError)(error) ? error.toString() : errorToString(error)

const defaultRenderShutdown = (cause: IntentionalShutdownCause | StoreInterrupted | SyncError) => {
  const reason =
    cause._tag === 'LiveStore.StoreInterrupted'
      ? `interrupted due to: ${cause.reason}`
      : cause._tag === 'InvalidPushError' || cause._tag === 'InvalidPullError'
        ? `sync error: ${cause.cause}`
        : cause.reason === 'devtools-import'
          ? 'devtools import'
          : cause.reason === 'devtools-reset'
            ? 'devtools reset'
            : cause.reason === 'adapter-reset'
              ? 'adapter reset'
              : cause.reason === 'manual'
                ? 'manual shutdown'
                : 'unknown reason'

  return IS_REACT_NATIVE ? null : <>LiveStore Shutdown due to {reason}</>
}

const defaultRenderLoading = (status: BootStatus) =>
  IS_REACT_NATIVE ? null : <>LiveStore is loading ({status.stage})...</>

export const LiveStoreProvider = ({
  renderLoading = defaultRenderLoading,
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
  debug,
}: LiveStoreProviderProps & React.PropsWithChildren): React.ReactNode => {
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
    debug,
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
    globalThis.__debugLiveStore._ = storeCtx.store
  }
  globalThis.__debugLiveStore[debug?.instanceId ?? storeId] = storeCtx.store

  return <LiveStoreContext.Provider value={storeCtx as TODO}>{children}</LiveStoreContext.Provider>
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
  debug,
}: CreateStoreOptions<LiveStoreSchema> & {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}) => {
  const [_, rerender] = React.useState(0)
  const ctxValueRef = React.useRef<{
    value: StoreContext_ | BootStatus
    componentScope: Scope.CloseableScope | undefined
    shutdownDeferred: ShutdownDeferred | undefined
    /** Used to wait for the previous shutdown deferred to fully complete before creating a new one */
    previousShutdownDeferred: ShutdownDeferred | undefined
    counter: number
  }>({
    value: { stage: 'loading' },
    componentScope: undefined,
    shutdownDeferred: undefined,
    previousShutdownDeferred: undefined,
    counter: 0,
  })
  const debugInstanceId = debug?.instanceId

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
    debugInstanceId,
  })

  const interrupt = React.useCallback(
    (componentScope: Scope.CloseableScope, shutdownDeferred: ShutdownDeferred, error: StoreInterrupted) =>
      Effect.gen(function* () {
        // console.log('[@livestore/livestore/react] interupting', error)
        yield* Scope.close(componentScope, Exit.fail(error))
        yield* Deferred.fail(shutdownDeferred, error)
      }).pipe(
        Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] interupting', cause)),
        Effect.runFork,
      ),
    [],
  )

  const inputPropChanges = {
    schema: inputPropsCacheRef.current.schema !== schema,
    otelOptions: inputPropsCacheRef.current.otelOptions !== otelOptions,
    boot: inputPropsCacheRef.current.boot !== boot,
    adapter: inputPropsCacheRef.current.adapter !== adapter,
    batchUpdates: inputPropsCacheRef.current.batchUpdates !== batchUpdates,
    disableDevtools: inputPropsCacheRef.current.disableDevtools !== disableDevtools,
    signal: inputPropsCacheRef.current.signal !== signal,
    context: inputPropsCacheRef.current.context !== context,
    params: inputPropsCacheRef.current.params !== params,
    confirmUnsavedChanges: inputPropsCacheRef.current.confirmUnsavedChanges !== confirmUnsavedChanges,
    syncPayload: inputPropsCacheRef.current.syncPayload !== syncPayload,
    debugInstanceId: inputPropsCacheRef.current.debugInstanceId !== debugInstanceId,
  }

  if (
    inputPropChanges.schema ||
    inputPropChanges.otelOptions ||
    inputPropChanges.boot ||
    inputPropChanges.adapter ||
    inputPropChanges.batchUpdates ||
    inputPropChanges.disableDevtools ||
    inputPropChanges.signal ||
    inputPropChanges.context ||
    inputPropChanges.params ||
    inputPropChanges.confirmUnsavedChanges ||
    inputPropChanges.syncPayload
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
      debugInstanceId,
    }
    if (ctxValueRef.current.componentScope !== undefined && ctxValueRef.current.shutdownDeferred !== undefined) {
      const changedInputProps = Object.keys(inputPropChanges).filter(
        (key) => inputPropChanges[key as keyof typeof inputPropChanges],
      )

      interrupt(
        ctxValueRef.current.componentScope,
        ctxValueRef.current.shutdownDeferred,
        new StoreInterrupted({ reason: `re-rendering due to changed input props: ${changedInputProps.join(', ')}` }),
      )
      ctxValueRef.current.componentScope = undefined
      ctxValueRef.current.shutdownDeferred = undefined
    }
    ctxValueRef.current = {
      value: { stage: 'loading' },
      componentScope: undefined,
      shutdownDeferred: undefined,
      previousShutdownDeferred: ctxValueRef.current.shutdownDeferred,
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

    const cancel = Effect.gen(function* () {
      // Wait for the previous store to fully shutdown before creating a new one
      if (ctxValueRef.current.previousShutdownDeferred) {
        yield* Deferred.await(ctxValueRef.current.previousShutdownDeferred)
      }

      const componentScope = yield* Scope.make().pipe(Effect.acquireRelease(Scope.close))
      const shutdownDeferred = yield* makeShutdownDeferred

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
          debug: { instanceId: debugInstanceId },
        }).pipe(Effect.tapErrorCause((cause) => Deferred.failCause(shutdownDeferred, cause)))

        setContextValue({ stage: 'running', store })
      }).pipe(Scope.extend(componentScope), Effect.forkIn(componentScope))

      const shutdownContext = (cause: IntentionalShutdownCause | StoreInterrupted | SyncError) =>
        Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

      yield* Deferred.await(shutdownDeferred).pipe(
        Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] shutdown', Cause.pretty(cause))),
        Effect.tap((intentionalShutdown) => shutdownContext(intentionalShutdown)),
        Effect.catchTag('InvalidPushError', (cause) => shutdownContext(cause)),
        Effect.catchTag('InvalidPullError', (cause) => shutdownContext(cause)),
        Effect.catchTag('LiveStore.StoreInterrupted', (cause) => shutdownContext(cause)),
        Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
        Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
        Effect.exit,
      )
    }).pipe(
      Effect.scoped,
      Effect.withSpan('@livestore/react:useCreateStore'),
      LS_DEV ? TaskTracing.withAsyncTaggingTracing((name: string) => (console as any).createTask(name)) : identity,
      provideOtel({ parentSpanContext: otelOptions?.rootSpanContext, otelTracer: otelOptions?.tracer }),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread: 'window' }),
      Effect.provide(Logger.prettyWithThread('window')),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runCallback,
    )

    return () => {
      cancel()

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
    debugInstanceId,
    interrupt,
  ])

  return ctxValueRef.current.value
}
