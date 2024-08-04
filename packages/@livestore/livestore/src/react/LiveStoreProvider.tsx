import { type BootDb, type BootStatus, type StoreAdapterFactory, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { errorToString } from '@livestore/utils'
import { Effect, FiberSet, Logger, LogLevel, Schema } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { BaseGraphQLContext, ForceStoreShutdown, GraphQLOptions, OtelOptions, StoreShutdown } from '../store.js'
import { createStore } from '../store.js'
import { LiveStoreContext } from './LiveStoreContext.js'

export class StoreAbort extends Schema.TaggedError<StoreAbort>()('LiveStore.StoreAbort', {}) {}
export class StoreInterrupted extends Schema.TaggedError<StoreInterrupted>()('LiveStore.StoreInterrupted', {}) {}

interface LiveStoreProviderProps<GraphQLContext> {
  schema: LiveStoreSchema
  boot?: (db: BootDb, parentSpan: otel.Span) => void | Promise<void> | Effect.Effect<void, unknown, otel.Tracer>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelOptions?: OtelOptions
  renderLoading: (status: BootStatus) => ReactElement
  adapter: StoreAdapterFactory
  batchUpdates?: (run: () => void) => void
  disableDevtools?: boolean
  signal?: AbortSignal
}

export const LiveStoreProvider = <GraphQLContext extends BaseGraphQLContext>({
  renderLoading,
  graphQLOptions,
  otelOptions,
  children,
  schema,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const storeCtx = useCreateStore({
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
    return (
      <div>
        {Schema.is(UnexpectedError)(storeCtx.error) ? storeCtx.error.toString() : errorToString(storeCtx.error)}
      </div>
    )
  }

  if (storeCtx.stage === 'shutdown') {
    return <div>LiveStore Shutdown</div>
  }

  if (storeCtx.stage !== 'running') {
    return <div>{renderLoading(storeCtx)}</div>
  }

  window.__debugLiveStore = storeCtx.store

  return <LiveStoreContext.Provider value={storeCtx}>{children}</LiveStoreContext.Provider>
}

const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  graphQLOptions,
  otelOptions,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
}: LiveStoreCreateStoreOptions<GraphQLContext>) => {
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
    signal,
  })

  const interrupt = (fiberSet: FiberSet.FiberSet, error: StoreAbort | StoreInterrupted) =>
    Effect.gen(function* () {
      yield* FiberSet.clear(fiberSet)
      yield* FiberSet.run(fiberSet, Effect.fail(error))
    }).pipe(Effect.ignoreLogged, Effect.runFork)

  if (
    inputPropsCacheRef.current.schema !== schema ||
    inputPropsCacheRef.current.graphQLOptions !== graphQLOptions ||
    inputPropsCacheRef.current.otelOptions !== otelOptions ||
    inputPropsCacheRef.current.boot !== boot ||
    inputPropsCacheRef.current.adapter !== adapter ||
    inputPropsCacheRef.current.batchUpdates !== batchUpdates ||
    inputPropsCacheRef.current.disableDevtools !== disableDevtools ||
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
        UnexpectedError | ForceStoreShutdown | StoreAbort | StoreInterrupted | StoreShutdown
      >()

      ctxValueRef.current.fiberSet = fiberSet

      yield* Effect.gen(function* () {
        const store = yield* createStore({
          fiberSet,
          schema,
          graphQLOptions,
          otelOptions,
          boot,
          adapter,
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

      const shutdownContext = Effect.sync(() => setContextValue({ stage: 'shutdown' }))

      yield* FiberSet.join(fiberSet).pipe(
        Effect.catchTag('LiveStore.StoreShutdown', () => shutdownContext),
        Effect.catchTag('LiveStore.ForceStoreShutdown', () => shutdownContext),
        Effect.catchTag('LiveStore.StoreAbort', () => shutdownContext),
        Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
        Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
        Effect.exit,
      )
    }).pipe(
      Effect.scoped,
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
  }, [schema, graphQLOptions, otelOptions, boot, adapter, batchUpdates, disableDevtools, signal])

  return ctxValueRef.current.value
}
