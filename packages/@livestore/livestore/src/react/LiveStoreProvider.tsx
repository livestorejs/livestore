import type { BootDb, DatabaseFactory } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { BaseGraphQLContext, GraphQLOptions, Store } from '../store.js'
import { createStore } from '../store.js'
import { LiveStoreContext } from './LiveStoreContext.js'

interface LiveStoreProviderProps<GraphQLContext> {
  schema: LiveStoreSchema
  boot?: (db: BootDb, parentSpan: otel.Span) => unknown | Promise<unknown>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  fallback: ReactElement
  makeDb: DatabaseFactory
  batchUpdates?: (run: () => void) => void
}

export const LiveStoreProvider = <GraphQLContext extends BaseGraphQLContext>({
  fallback,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  children,
  schema,
  boot,
  makeDb,
  batchUpdates,
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const storeCtx = useCreateStore({
    schema,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
    boot,
    makeDb,
    batchUpdates,
  })

  if (storeCtx === undefined) {
    return fallback
  }

  window.__debugLiveStore = storeCtx.store

  return <LiveStoreContext.Provider value={storeCtx}>{children}</LiveStoreContext.Provider>
}

const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  boot,
  makeDb,
  batchUpdates,
}: LiveStoreCreateStoreOptions<GraphQLContext>) => {
  const [_, rerender] = React.useState(0)
  const ctxValueRef = React.useRef<StoreContext_ | undefined>(undefined)
  const inputPropsCacheRef = React.useRef({
    schema,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
    boot,
    makeDb,
    batchUpdates,
  })
  const oldStoreAlreadyDestroyedRef = React.useRef(false)

  if (
    inputPropsCacheRef.current.schema !== schema ||
    inputPropsCacheRef.current.graphQLOptions !== graphQLOptions ||
    inputPropsCacheRef.current.otelTracer !== otelTracer ||
    inputPropsCacheRef.current.otelRootSpanContext !== otelRootSpanContext ||
    inputPropsCacheRef.current.boot !== boot ||
    inputPropsCacheRef.current.makeDb !== makeDb ||
    inputPropsCacheRef.current.batchUpdates !== batchUpdates
  ) {
    inputPropsCacheRef.current = {
      schema,
      graphQLOptions,
      otelTracer,
      otelRootSpanContext,
      boot,
      makeDb,
      batchUpdates,
    }
    ctxValueRef.current?.store.destroy()
    oldStoreAlreadyDestroyedRef.current = true
    ctxValueRef.current = undefined
  }

  React.useEffect(() => {
    let store: Store | undefined

    void (async () => {
      try {
        store = await createStore({
          schema,
          graphQLOptions,
          otelTracer,
          otelRootSpanContext,
          boot,
          makeDb,
          batchUpdates,
        })
        ctxValueRef.current = { store }
        oldStoreAlreadyDestroyedRef.current = false
        rerender((c) => c + 1)
      } catch (e) {
        shouldNeverHappen(`Error creating LiveStore store: ${e}`)
      }
    })()

    return () => {
      if (oldStoreAlreadyDestroyedRef.current === false) {
        store?.destroy()
      }
    }
  }, [schema, graphQLOptions, otelTracer, otelRootSpanContext, boot, makeDb, batchUpdates])

  return ctxValueRef.current
}
