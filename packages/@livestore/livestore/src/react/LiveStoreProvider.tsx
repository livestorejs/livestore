import type { BootDb, BootStatus, StoreAdapterFactory } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { shouldNeverHappen } from '@livestore/utils'
import type * as otel from '@opentelemetry/api'
import type { ReactElement, ReactNode } from 'react'
import React from 'react'

// TODO refactor so the `react` module doesn't depend on `effect` module
import type { LiveStoreContext as StoreContext_, LiveStoreCreateStoreOptions } from '../effect/LiveStore.js'
import type { BaseGraphQLContext, GraphQLOptions, OtelOptions, Store } from '../store.js'
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
}: LiveStoreProviderProps<GraphQLContext> & { children?: ReactNode }): JSX.Element => {
  const storeCtx = useCreateStore({
    schema,
    graphQLOptions,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
    disableDevtools,
  })

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
}: LiveStoreCreateStoreOptions<GraphQLContext>) => {
  const [_, rerender] = React.useState(0)
  const ctxValueRef = React.useRef<StoreContext_ | BootStatus>({ stage: 'loading' })
  const inputPropsCacheRef = React.useRef({
    schema,
    graphQLOptions,
    otelOptions,
    boot,
    adapter,
    batchUpdates,
  })
  const oldStoreAlreadyDestroyedRef = React.useRef(false)

  if (
    inputPropsCacheRef.current.schema !== schema ||
    inputPropsCacheRef.current.graphQLOptions !== graphQLOptions ||
    inputPropsCacheRef.current.otelOptions !== otelOptions ||
    inputPropsCacheRef.current.boot !== boot ||
    inputPropsCacheRef.current.adapter !== adapter ||
    inputPropsCacheRef.current.batchUpdates !== batchUpdates
  ) {
    inputPropsCacheRef.current = {
      schema,
      graphQLOptions,
      otelOptions,
      boot,
      adapter,
      batchUpdates,
    }
    if (ctxValueRef.current.stage === 'running') {
      ctxValueRef.current.store.destroy()
      oldStoreAlreadyDestroyedRef.current = true
      ctxValueRef.current = { stage: 'loading' }
    }
  }

  React.useEffect(() => {
    let store: Store | undefined

    void (async () => {
      try {
        store = await createStore({
          schema,
          graphQLOptions,
          otelOptions,
          boot,
          adapter,
          batchUpdates,
          disableDevtools,
          onBootStatus: (status) => {
            if (ctxValueRef.current.stage === 'running') return
            ctxValueRef.current = status
            rerender((c) => c + 1)
          },
        })
        ctxValueRef.current = { stage: 'running', store }
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
  }, [schema, graphQLOptions, otelOptions, boot, adapter, batchUpdates, disableDevtools])

  return ctxValueRef.current
}
