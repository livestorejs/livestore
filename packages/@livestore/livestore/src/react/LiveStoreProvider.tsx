import type * as otel from '@opentelemetry/api'
import { mapValues } from 'lodash-es'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type {
  GlobalQueryDefs,
  LiveStoreContext as StoreContext_,
  LiveStoreCreateStoreOptions,
} from '../effect/LiveStore.js'
import type { Schema } from '../schema.js'
import type { Storage, StorageInit } from '../storage/index.js'
import type { BaseGraphQLContext, GraphQLOptions } from '../store.js'
import { createStore } from '../store.js'
import { LiveStoreContext } from './LiveStoreContext.js'

interface LiveStoreProviderProps<GraphQLContext> {
  schema: Schema
  loadStorage: () => Promise<StorageInit>
  boot?: (storage: Storage, parentSpan: otel.Span) => Promise<void>
  globalQueryDefs: GlobalQueryDefs
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  fallback: ReactElement
}

export const LiveStoreProvider = <GraphQLContext extends BaseGraphQLContext>({
  fallback,
  globalQueryDefs,
  loadStorage,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  children,
  schema,
  boot,
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const store = useCreateStore({
    schema,
    globalQueryDefs,
    loadStorage,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
    boot,
  })

  if (store === undefined) {
    return fallback
  }

  window.__debugLiveStore = store.store

  return <LiveStoreContext.Provider value={store}>{children}</LiveStoreContext.Provider>
}

const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  globalQueryDefs,
  loadStorage,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  boot,
}: LiveStoreCreateStoreOptions<GraphQLContext>) => {
  const [ctxValue, setCtxValue] = React.useState<StoreContext_ | undefined>()

  React.useEffect(() => {
    void (async () => {
      try {
        const store = await createStore({
          schema,
          loadStorage,
          graphQLOptions,
          otelTracer,
          otelRootSpanContext,
          boot,
        })
        store.otel.tracer.startActiveSpan('LiveStore:makeGlobalQueries', {}, store.otel.queriesSpanContext, (span) => {
          const globalQueries = mapValues(globalQueryDefs, (queryDef) => queryDef(store))
          setCtxValue({ store, globalQueries })
          span.end()
        })
      } catch (e) {
        console.error(`Error creating LiveStore store:`, e)
        throw e
      }
    })()

    // TODO: do we need to return any cleanup function here?
  }, [schema, loadStorage, globalQueryDefs, graphQLOptions, otelTracer, otelRootSpanContext, boot])

  return ctxValue
}
