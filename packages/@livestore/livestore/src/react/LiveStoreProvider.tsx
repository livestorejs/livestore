import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

import type { DatabaseFactory } from '../database.js'
// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { InMemoryDatabase } from '../inMemoryDatabase.js'
import type { LiveStoreSchema } from '../schema/index.js'
import type { StorageInit } from '../storage/index.js'
import type { BaseGraphQLContext, GraphQLOptions, Store } from '../store.js'
import { createStore } from '../store.js'
import { LiveStoreContext } from './LiveStoreContext.js'

interface LiveStoreProviderProps<GraphQLContext> {
  schema: LiveStoreSchema
  loadStorage?: () => StorageInit | Promise<StorageInit>
  boot?: (db: InMemoryDatabase, parentSpan: otel.Span) => unknown | Promise<unknown>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  fallback: ReactElement
  sqlite3: DatabaseFactory
}

export const LiveStoreProvider = <GraphQLContext extends BaseGraphQLContext>({
  fallback,
  loadStorage,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  children,
  schema,
  boot,
  sqlite3,
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const store = useCreateStore({
    schema,
    loadStorage,
    graphQLOptions,
    otelTracer,
    otelRootSpanContext,
    boot,
    sqlite3,
  })

  if (store === undefined) {
    return fallback
  }

  window.__debugLiveStore = store.store

  return <LiveStoreContext.Provider value={store}>{children}</LiveStoreContext.Provider>
}

const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  loadStorage,
  graphQLOptions,
  otelTracer,
  otelRootSpanContext,
  boot,
  sqlite3,
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
          loadStorage,
          graphQLOptions,
          otelTracer,
          otelRootSpanContext,
          boot,
          sqlite3,
        })
        setCtxValue({ store })
      } catch (e) {
        shouldNeverHappen(`Error creating LiveStore store: ${e}`)
      }
    })()

    return () => {
      store?.destroy()
    }
  }, [schema, loadStorage, graphQLOptions, otelTracer, otelRootSpanContext, boot, sqlite3])

  return ctxValue
}
