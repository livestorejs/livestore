import type { Adapter, BootStatus, IntentionalShutdownCause } from '@livestore/common'
import { UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import type {
  BaseGraphQLContext,
  CreateStoreOptions,
  GraphQLOptions,
  LiveStoreContext as StoreContext_,
  OtelOptions,
  Store,
} from '@livestore/livestore'
import { createStore, StoreAbort, StoreInterrupted } from '@livestore/livestore'
import { errorToString } from '@livestore/utils'
import { Effect, FiberSet, Logger, LogLevel, Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

import { LiveStoreContext } from './LiveStoreContext.js'

interface LiveStoreProviderProps<GraphQLContext extends BaseGraphQLContext> {
  schema: LiveStoreSchema
  /**
   * The `storeId` can be used to isolate multiple stores from each other.
   * So it can be useful for multi-tenancy scenarios.
   *
   * The `storeId` is also used for persistence.
   *
   * Make sure to also provide `storeId` to `mountDevtools` in `_devtools.html`.
   *
   * @default 'default'
   */
  storeId?: string
  boot?: (
    store: Store<GraphQLContext, LiveStoreSchema>,
    parentSpan: otel.Span,
  ) => void | Promise<void> | Effect.Effect<void, unknown, otel.Tracer>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelOptions?: OtelOptions
  renderLoading: (status: BootStatus) => ReactElement
  renderError?: (error: UnexpectedError | unknown) => ReactElement
  renderShutdown?: (cause: IntentionalShutdownCause | StoreAbort) => ReactElement
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
}

const defaultRenderError = (error: UnexpectedError | unknown) => (
  <>{Schema.is(UnexpectedError)(error) ? error.toString() : errorToString(error)}</>
)
const defaultRenderShutdown = (cause: IntentionalShutdownCause | StoreAbort) => {
  const reason =
    cause._tag === 'LiveStore.StoreAbort'
      ? 'abort signal'
      : cause.reason === 'devtools-import'
        ? 'devtools import'
        : cause.reason === 'devtools-reset'
          ? 'devtools reset'
          : 'unknown reason'

  return <>LiveStore Shutdown due to {reason}</>
}

export const LiveStoreProvider = <GraphQLContext extends BaseGraphQLContext>({
  renderLoading,
  renderError = defaultRenderError,
  renderShutdown = defaultRenderShutdown,
  graphQLOptions,
  otelOptions,
  children,
  schema,
  storeId = 'default',
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const storeCtx = useCreateStore({
    storeId,
    schema,
    graphQLOptions,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    signal,
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

const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  storeId,
  graphQLOptions,
  otelOptions,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  reactivityGraph,
  signal,
}: CreateStoreOptions<GraphQLContext, LiveStoreSchema> & { signal?: AbortSignal }) => {
  const [_, rerender] = React.useState(0)
  const ctxValueRef = React.useRef<{
    value: StoreContext_ | BootStatus
    fiberSet: FiberSet.FiberSet | undefined
    counter: number
  }>({
    value: { stage: 'loading' },
    fiberSet: undefined,
    counter: 0,
  })

  // console.debug(`useCreateStore (${ctxValueRef.current.counter})`, ctxValueRef.current.value.stage)

  const inputPropsCacheRef = React.useRef({
    schema,
    graphQLOptions,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    reactivityGraph,
    signal,
  })

  const interrupt = (fiberSet: FiberSet.FiberSet, error: StoreAbort | StoreInterrupted) =>
    Effect.gen(function* () {
      yield* FiberSet.clear(fiberSet)
      yield* FiberSet.run(fiberSet, Effect.fail(error))
    }).pipe(
      Effect.tapErrorCause((cause) => Effect.logDebug(`[@livestore/livestore/react] interupting`, cause)),
      Effect.runFork,
    )

  if (
    inputPropsCacheRef.current.schema !== schema ||
    inputPropsCacheRef.current.graphQLOptions !== graphQLOptions ||
    inputPropsCacheRef.current.otelOptions !== otelOptions ||
    inputPropsCacheRef.current.boot !== boot ||
    inputPropsCacheRef.current.adapter !== adapter ||
    inputPropsCacheRef.current.batchUpdates !== batchUpdates ||
    inputPropsCacheRef.current.disableDevtools !== disableDevtools ||
    inputPropsCacheRef.current.reactivityGraph !== reactivityGraph ||
    inputPropsCacheRef.current.signal !== signal
  ) {
    inputPropsCacheRef.current = {
      schema,
      graphQLOptions,
      otelOptions,
      boot,
      adapter,
      batchUpdates,
      disableDevtools,
      reactivityGraph,
      signal,
    }
    if (ctxValueRef.current.fiberSet !== undefined) {
      interrupt(ctxValueRef.current.fiberSet, new StoreInterrupted())
      ctxValueRef.current.fiberSet = undefined
    }
    ctxValueRef.current = { value: { stage: 'loading' }, fiberSet: undefined, counter: ctxValueRef.current.counter + 1 }
  }

  React.useEffect(() => {
    const counter = ctxValueRef.current.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (ctxValueRef.current.counter !== counter) return
      ctxValueRef.current.value = value
      rerender((c) => c + 1)
    }

    signal?.addEventListener('abort', () => {
      if (ctxValueRef.current.fiberSet !== undefined && ctxValueRef.current.counter === counter) {
        interrupt(ctxValueRef.current.fiberSet, new StoreAbort())
        ctxValueRef.current.fiberSet = undefined
      }
    })

    Effect.gen(function* () {
      const fiberSet = yield* FiberSet.make<
        unknown,
        UnexpectedError | IntentionalShutdownCause | StoreAbort | StoreInterrupted
      >()

      ctxValueRef.current.fiberSet = fiberSet

      yield* Effect.gen(function* () {
        const store = yield* createStore({
          fiberSet,
          schema,
          storeId,
          graphQLOptions,
          otelOptions,
          boot,
          adapter,
          reactivityGraph,
          batchUpdates,
          disableDevtools,
          onBootStatus: (status) => {
            if (ctxValueRef.current.value.stage === 'running' || ctxValueRef.current.value.stage === 'error') return
            setContextValue(status)
          },
        })

        setContextValue({ stage: 'running', store })

        yield* Effect.never
      }).pipe(Effect.scoped, FiberSet.run(fiberSet))

      const shutdownContext = (cause: IntentionalShutdownCause | StoreAbort) =>
        Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

      yield* FiberSet.join(fiberSet).pipe(
        Effect.catchTag('LiveStore.IntentionalShutdownCause', (cause) => shutdownContext(cause)),
        Effect.catchTag('LiveStore.StoreAbort', (cause) => shutdownContext(cause)),
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
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread: 'window' }),
      Effect.provide(Logger.pretty),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runFork,
    )

    return () => {
      if (ctxValueRef.current.fiberSet !== undefined) {
        interrupt(ctxValueRef.current.fiberSet, new StoreInterrupted())
        ctxValueRef.current.fiberSet = undefined
      }
    }
  }, [
    schema,
    graphQLOptions,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
    signal,
    reactivityGraph,
    storeId,
  ])

  return ctxValueRef.current.value
}
