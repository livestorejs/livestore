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
  type JSX,
  Match,
  mergeProps,
  on,
  onCleanup,
  type ParentProps,
  splitProps,
  Switch,
} from 'solid-js'
import { createStore as createSolidStore, reconcile } from 'solid-js/store'
import { trackDeep } from '@solid-primitives/deep'
import { LiveStoreContext } from './LiveStoreContext.ts'
import type { MakeOptional } from './utils.ts'

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
  return (
    <>
      LiveStore Shutdown due to{' '}
      {cause._tag === 'LiveStore.StoreInterrupted'
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
                  : 'unknown reason'}
    </>
  )
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
  const [, rest] = splitProps(config, ['children'])

  const storeContext = createStoreContext(rest)

  return (
    <Switch
      fallback={
        // SOLID  - should we untrack render functions?
        config.renderLoading(storeContext as BootStatus)
      }
    >
      <Match when={storeContext.stage === 'error' && storeContext}>
        {(ctx) =>
          // SOLID  - should we untrack render functions?
          config.renderError(ctx().error)
        }
      </Match>
      <Match when={storeContext.stage === 'shutdown' && storeContext}>
        {(ctx) =>
          // SOLID  - should we untrack render functions?
          config.renderShutdown(ctx().cause)
        }
      </Match>
      <Match when={storeContext.stage === 'running' && storeContext}>
        {(ctx) => {
          globalThis.__debugLiveStore ??= {}
          if (Object.keys(globalThis.__debugLiveStore).length === 0) {
            globalThis.__debugLiveStore._ = ctx().store
          }
          globalThis.__debugLiveStore[config.debug?.instanceId ?? config.storeId] = ctx().store
          return (
            <LiveStoreContext.Provider
              value={
                // SOLID  - according to the types it should also receive useQuery and useClientDocument
                //          but this is not currently implemented in the react implementation and is anotated with TODO
                ctx() as TODO
              }
            >
              {config.children}
            </LiveStoreContext.Provider>
          )
        }}
      </Match>
    </Switch>
  )
}

interface CreateStoreContextOptions
  extends Exclude<CreateStoreOptions<LiveStoreSchema>, 'batchUpdates' | 'onBootStatus'> {
  signal?: AbortSignal
  otelOptions?: Partial<OtelOptions>
}

interface CreateStoreContextState {
  componentScope: Scope.CloseableScope | undefined
  shutdownDeferred: ShutdownDeferred | undefined
  /** Used to wait for the previous shutdown deferred to fully complete before creating a new one */
  previousShutdownDeferred: ShutdownDeferred | undefined
  counter: number
}

const createStoreContext = (options: CreateStoreContextOptions) => {
  const [storeContext, _setStoreContext] = createSolidStore<StoreContext_ | BootStatus>({ stage: 'loading' })

  const state: {
    componentScope: Scope.CloseableScope | undefined
    shutdownDeferred: ShutdownDeferred | undefined
    /** Used to wait for the previous shutdown deferred to fully complete before creating a new one */
    previousShutdownDeferred: ShutdownDeferred | undefined
    counter: number
  } = {
    componentScope: undefined,
    shutdownDeferred: undefined,
    previousShutdownDeferred: undefined,
    counter: 0,
  }

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
      () => trackDeep(options),
      () => {
        if (state.componentScope !== undefined && state.shutdownDeferred !== undefined) {
          interrupt(
            state.componentScope,
            state.shutdownDeferred,
            new StoreInterrupted({
              reason: `re-rendering due to changed input props: ${''}`,
            }),
          )
        }

        _setStoreContext({ stage: 'loading' })

        state.componentScope = undefined
        state.shutdownDeferred = undefined
        state.previousShutdownDeferred = state.shutdownDeferred
        state.counter = state.counter + 1

        const counter = state.counter

        const setStoreContext = (value: StoreContext_ | BootStatus) => {
          if (state.counter !== counter) return
          _setStoreContext(reconcile(value))
        }

        options.signal?.addEventListener('abort', () => {
          if (state.componentScope !== undefined && state.shutdownDeferred !== undefined && state.counter === counter) {
            interrupt(
              state.componentScope,
              state.shutdownDeferred,
              new StoreInterrupted({ reason: 'Aborted via provided AbortController' }),
            )
            state.componentScope = undefined
            state.shutdownDeferred = undefined
          }
        })

        const cancelStore = createStoreEffect(state, storeContext, setStoreContext, options)

        onCleanup(() => {
          cancelStore()

          if (state.componentScope !== undefined && state.shutdownDeferred !== undefined) {
            interrupt(
              state.componentScope,
              state.shutdownDeferred,
              new StoreInterrupted({ reason: 'unmounting component' }),
            )
            state.componentScope = undefined
            state.shutdownDeferred = undefined
          }
        })
      },
    ),
  )

  return storeContext
}

const createStoreEffect = (
  state: CreateStoreContextState,
  storeContext: StoreContext_ | BootStatus,
  setStoreContext: (value: StoreContext_ | BootStatus) => void,
  options: MakeOptional<
    CreateStoreContextOptions,
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
    if (state.previousShutdownDeferred) {
      yield* Deferred.await(state.previousShutdownDeferred)
    }

    const componentScope = yield* Scope.make().pipe(Effect.acquireRelease(Scope.close))
    const shutdownDeferred = yield* makeShutdownDeferred

    state.componentScope = componentScope
    state.shutdownDeferred = shutdownDeferred

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
          if (storeContext.stage === 'running' || storeContext.stage === 'error') return
          // NOTE sometimes when status come in in rapid succession, only the last value will be rendered by React
          setStoreContext(status)
        },
        debug: { ...omitUndefineds({ instanceId: options.debug?.instanceId }) },
      }).pipe(Effect.tapErrorCause((cause) => Deferred.failCause(shutdownDeferred, cause)))

      setStoreContext({ stage: 'running', store })
    }).pipe(Scope.extend(componentScope), Effect.forkIn(componentScope))

    const shutdownContext = (cause: IntentionalShutdownCause | StoreInterrupted | SyncError) =>
      Effect.sync(() => setStoreContext({ stage: 'shutdown', cause }))

    yield* Deferred.await(shutdownDeferred).pipe(
      Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] shutdown', Cause.pretty(cause))),
      Effect.tap((intentionalShutdown) => shutdownContext(intentionalShutdown)),
      Effect.catchTag('InvalidPushError', (cause) => shutdownContext(cause)),
      Effect.catchTag('InvalidPullError', (cause) => shutdownContext(cause)),
      Effect.catchTag('LiveStore.StoreInterrupted', (cause) => shutdownContext(cause)),
      Effect.tapError((error) => Effect.sync(() => setStoreContext({ stage: 'error', error }))),
      Effect.tapDefect((defect) => Effect.sync(() => setStoreContext({ stage: 'error', error: defect }))),
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
