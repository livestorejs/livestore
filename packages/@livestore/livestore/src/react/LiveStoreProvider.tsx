import type { DatabaseFactory } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { BaseGraphQLContext, BootDb, GraphQLOptions, Store } from '../store.js'
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
  const [ctxValue, setCtxValue] = React.useState<StoreContext_ | undefined>()

  React.useEffect(() => {
    let store: Store | undefined

    // resetting the store context while we're creating a new store
    setCtxValue(undefined)

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
        setCtxValue({ store })
      } catch (e) {
        shouldNeverHappen(`Error creating LiveStore store: ${e}`)
      }
    })()

    return () => {
      store?.destroy()
    }
  }, [schema, graphQLOptions, otelTracer, otelRootSpanContext, boot, makeDb, batchUpdates])

  return ctxValue
}
