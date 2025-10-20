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
import { errorToString, LS_DEV, omitUndefineds } from '@livestore/utils'
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
import {
  batch,
  createComputed,
  createEffect,
  createMemo,
  type JSX,
  type JSXElement,
  mergeProps,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js'
import { createStore as createSolidStore, reconcile } from 'solid-js/store'
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
  renderLoading?: (status: BootStatus) => JSX.Element
  renderError?: (error: UnexpectedError | unknown) => JSX.Element
  renderShutdown?: (cause: IntentionalShutdownCause | StoreInterrupted | SyncError) => JSX.Element
  adapter: Adapter
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

const defaultRenderError = (error: UnexpectedError | unknown) => (
  <>{Schema.is(UnexpectedError)(error) ? error.toString() : errorToString(error)}</>
)

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

  return <>LiveStore Shutdown due to {reason}</>
}

const defaultRenderLoading = (status: BootStatus) => <>LiveStore is loading ({status.stage})...</>

export const LiveStoreProvider = (props: LiveStoreProviderProps & ParentProps) => {
  const config = mergeProps(
    {
      renderLoading: defaultRenderLoading,
      renderError: defaultRenderError,
      renderShutdown: defaultRenderShutdown,
      storeId: 'default',
      confirmUnsavedChanges: true,
    },
    props,
  )
  const storeCtx = useCreateStore({
    storeId: config.storeId,
    schema: config.schema,
    adapter: config.adapter,
    confirmUnsavedChanges: config.confirmUnsavedChanges,
    ...omitUndefineds({
      otelOptions: config.otelOptions,
      boot: config.boot,
      disableDevtools: config.disableDevtools,
      signal: config.signal,
      syncPayload: config.syncPayload,
      debug: config.debug,
    }),
  })

  return createMemo(() => {
    switch (storeCtx.stage) {
      case 'error':
        return config.renderError(storeCtx.error)
      case 'shutdown':
        return config.renderShutdown(storeCtx.cause)
      case 'running':
        globalThis.__debugLiveStore ??= {}
        if (Object.keys(globalThis.__debugLiveStore).length === 0) {
          globalThis.__debugLiveStore._ = storeCtx.store
        }
        globalThis.__debugLiveStore[config.debug?.instanceId ?? config.storeId] = storeCtx.store
        return <LiveStoreContext.Provider value={storeCtx}>{config.children}</LiveStoreContext.Provider>
      default:
        return config.renderLoading(storeCtx as BootStatus)
    }
  }) as unknown as JSXElement
}

interface UseCreateStoreOptions extends Omit<CreateStoreOptions<LiveStoreSchema>, 'batchUpdates'> {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}

const useCreateStore = (options: UseCreateStoreOptions) => {
  const [contextValue, _setContextValue] = createSolidStore<StoreContext_ | BootStatus>({ stage: 'loading' })

  const [context, setContext] = createSolidStore<{
    componentScope: Scope.CloseableScope | undefined
    shutdownDeferred: ShutdownDeferred | undefined
    /** Used to wait for the previous shutdown deferred to fully complete before creating a new one */
    previousShutdownDeferred: ShutdownDeferred | undefined
    counter: number
  }>({
    componentScope: undefined,
    shutdownDeferred: undefined,
    previousShutdownDeferred: undefined,
    counter: 0,
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

  createComputed(
    on(
      () => ({ ...options }),
      () => {
        if (context.componentScope !== undefined && context.shutdownDeferred !== undefined) {
          interrupt(
            context.componentScope,
            context.shutdownDeferred,
            new StoreInterrupted({
              reason: `re-rendering due to changed input props: ${''}`,
            }),
          )

          setContext({
            componentScope: undefined,
            shutdownDeferred: undefined,
          })
        }

        setContext((context) => ({
          value: { stage: 'loading' },
          componentScope: undefined,
          shutdownDeferred: undefined,
          previousShutdownDeferred: context.shutdownDeferred,
          counter: context.counter + 1,
        }))
      },
    ),
  )

  createEffect(() => {
    const counter = context.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (context.counter !== counter) return
      _setContextValue(reconcile(value))
    }

    options.signal?.addEventListener('abort', () => {
      if (
        context.componentScope !== undefined &&
        context.shutdownDeferred !== undefined &&
        context.counter === counter
      ) {
        interrupt(
          context.componentScope,
          context.shutdownDeferred,
          new StoreInterrupted({ reason: 'Aborted via provided AbortController' }),
        )
        setContext({
          componentScope: undefined,
          shutdownDeferred: undefined,
        })
      }
    })

    const cancelStore = createCancelStore(context, setContext, contextValue, setContextValue, options)

    onCleanup(() => {
      cancelStore()

      if (context.componentScope !== undefined && context.shutdownDeferred !== undefined) {
        interrupt(
          context.componentScope,
          context.shutdownDeferred,
          new StoreInterrupted({ reason: 'unmounting component' }),
        )
        setContext({
          componentScope: undefined,
          shutdownDeferred: undefined,
        })
      }
    })
  })

  return contextValue
}

interface Context {
  componentScope: Scope.CloseableScope | undefined
  shutdownDeferred: ShutdownDeferred | undefined
  /** Used to wait for the previous shutdown deferred to fully complete before creating a new one */
  previousShutdownDeferred: ShutdownDeferred | undefined
  counter: number
}

type MakeOptional<T, TKeys extends keyof T> = Omit<T, TKeys> & { [TKey in TKeys]: T[TKey] | undefined }

const createCancelStore = (
  context: Context,
  setContext: (context: Partial<Context>) => void,
  contextValue: StoreContext_ | BootStatus,
  setContextValue: (value: StoreContext_ | BootStatus) => void,
  options: MakeOptional<
    UseCreateStoreOptions,
    | 'boot'
    | 'confirmUnsavedChanges'
    | 'context'
    | 'debug'
    | 'disableDevtools'
    | 'otelOptions'
    | 'params'
    | 'signal'
    | 'syncPayload'
  >,
) => {
  return Effect.gen(function* () {
    // Wait for the previous store to fully shutdown before creating a new one
    if (context.previousShutdownDeferred) {
      yield* Deferred.await(context.previousShutdownDeferred)
    }

    const componentScope = yield* Scope.make().pipe(Effect.acquireRelease(Scope.close))
    const shutdownDeferred = yield* makeShutdownDeferred

    setContext({
      componentScope,
      shutdownDeferred,
    })

    yield* Effect.gen(function* () {
      const store = yield* createStore({
        schema: options.schema,
        storeId: options.storeId,
        adapter: options.adapter,
        shutdownDeferred,
        batchUpdates: batch,
        ...omitUndefineds({
          boot: options.boot,
          disableDevtools: options.disableDevtools,
          context: options.context,
          params: options.params,
          confirmUnsavedChanges: options.confirmUnsavedChanges,
          syncPayload: options.syncPayload,
        }),
        onBootStatus: (status) => {
          if (contextValue.stage === 'running' || contextValue.stage === 'error') return
          // NOTE sometimes when status come in in rapid succession, only the last value will be rendered by React
          setContextValue(status)
        },
        debug: { ...omitUndefineds({ instanceId: options.debug?.instanceId }) },
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
    provideOtel(
      omitUndefineds({
        parentSpanContext: options.otelOptions?.rootSpanContext,
        otelTracer: options.otelOptions?.tracer,
      }),
    ),
    Effect.tapCauseLogPretty,
    Effect.annotateLogs({ thread: 'window' }),
    Effect.provide(Logger.prettyWithThread('window')),
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.runCallback,
  )
}
