import { type BootDb, type BootStatus, type StoreAdapterFactory, UnexpectedError } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { errorToString } from '@livestore/utils'
import { Effect, Exit, FiberSet, Logger, LogLevel, Schema, Scope } from '@livestore/utils/effect'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { BaseGraphQLContext, GraphQLOptions, OtelOptions } from '../store.js'
import { createStore } from '../store.js'
import { LiveStoreContext } from './LiveStoreContext.js'

interface LiveStoreProviderProps<GraphQLContext> {
  schema: LiveStoreSchema
  boot?: (db: BootDb, parentSpan: otel.Span) => unknown | Promise<unknown>
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
    scope: Scope.CloseableScope | undefined
    counter: number
  }>({
    value: { stage: 'loading' },
    scope: undefined,
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
    if (ctxValueRef.current.scope !== undefined) {
      Scope.close(ctxValueRef.current.scope, Exit.void).pipe(Effect.tapCauseLogPretty, Effect.runFork)
    }
    ctxValueRef.current = { value: { stage: 'loading' }, scope: undefined, counter: ctxValueRef.current.counter + 1 }
  }

  React.useEffect(() => {
    const storeScope = Scope.make().pipe(Effect.runSync)

    const counter = ctxValueRef.current.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (ctxValueRef.current.counter !== counter) return
      ctxValueRef.current.value = value
      rerender((c) => c + 1)
    }

    Scope.addFinalizer(
      storeScope,
      Effect.sync(() => setContextValue({ stage: 'shutdown' })),
    ).pipe(Effect.runSync)

    ctxValueRef.current.scope = storeScope

    signal?.addEventListener('abort', () => {
      if (ctxValueRef.current.scope !== undefined && ctxValueRef.current.counter === counter) {
        Scope.close(ctxValueRef.current.scope, Exit.void).pipe(Effect.tapCauseLogPretty, Effect.runFork)
        ctxValueRef.current.scope = undefined
      }
    })

    FiberSet.make().pipe(
      Effect.andThen((fiberSet) =>
        createStore({
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
        }),
      ),
      Effect.tapSync((store) => setContextValue({ stage: 'running', store })),
      Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
      Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
      Scope.extend(storeScope),
      Effect.forkIn(storeScope),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread: 'window' }),
      Effect.provide(Logger.pretty),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runFork,
    )

    return () => {
      if (ctxValueRef.current.scope !== undefined) {
        Scope.close(ctxValueRef.current.scope, Exit.void).pipe(Effect.tapCauseLogPretty, Effect.runFork)
        ctxValueRef.current.scope = undefined
      }
    }
  }, [schema, graphQLOptions, otelOptions, boot, adapter, batchUpdates, disableDevtools, signal])

  return ctxValueRef.current.value
}
