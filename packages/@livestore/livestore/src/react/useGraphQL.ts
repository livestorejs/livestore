import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import * as otel from '@opentelemetry/api'
import { isEqual } from 'lodash-es'
import React from 'react'

import { labelForKey } from '../componentKey.js'
import { useStore } from './LiveStoreContext.js'
import { type ComponentKeyConfig, useComponentKey } from './useLiveStoreComponent.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export type UseLiveStoreComponentProps<TResult extends Record<string, any>, TVariables extends Record<string, any>> = {
  query: DocumentNode<TResult, TVariables>
  variables: TVariables
  componentKey: ComponentKeyConfig
  reactDeps?: React.DependencyList
}

/**
 * This is needed because the `React.useMemo` call below, can sometimes be called multiple times 🤷,
 * so we need to "cache" the fact that we've already started a span for this component.
 * The map entry is being removed again in the `React.useEffect` call below.
 */
const spanAlreadyStartedCache = new Map<string, { span: otel.Span; otelCtx: otel.Context }>()

// TODO 1) figure out a way to make `variables` optional if the query doesn't have any variables (probably requires positional args)
// TODO 2) allow `.pipe` on the resulting query (possibly as a separate optional prop)
export const useGraphQL = <TResult extends Record<string, any>, TVariables extends Record<string, any> = {}>({
  query,
  variables,
  componentKey: componentKeyConfig,
  reactDeps = [],
}: UseLiveStoreComponentProps<TResult, TVariables>): Readonly<TResult> => {
  const componentKey = useComponentKey(componentKeyConfig, reactDeps)
  const { store } = useStore()

  const componentKeyLabel = React.useMemo(() => labelForKey(componentKey), [componentKey])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelCtx } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(componentKeyLabel)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useGraphQL:${componentKeyLabel}`,
      {},
      store.otel.queriesSpanContext,
    )

    const otelCtx = otel.trace.setSpan(otel.context.active(), span)

    spanAlreadyStartedCache.set(componentKeyLabel, { span, otelCtx })

    return { span, otelCtx }
  }, [componentKeyLabel, store.otel.queriesSpanContext, store.otel.tracer])

  React.useEffect(
    () => () => {
      spanAlreadyStartedCache.delete(componentKeyLabel)
      span.end()
    },
    [componentKeyLabel, span],
  )

  const makeLiveStoreQuery = React.useCallback(
    () => store.queryGraphQL(query, () => variables ?? ({} as TVariables), { componentKey }, otelCtx),
    // NOTE: we don't include the queries function passed in by the user here;
    // the reason is that we don't want to force them to memoize that function.
    // Instead, we just assume that the function always has the same contents.
    // This makes sense for LiveStore because the component config should be static.
    // TODO: document this and consider whether it's the right API surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentKey, store],
  )

  // TODO get rid of the temporary query workaround
  const initialQueryResults = React.useMemo(
    () => store.inTempQueryContext(() => makeLiveStoreQuery().results$.result),
    [makeLiveStoreQuery, store],
  )

  const [queryResultsRef, setQueryResults_] = useStateRefWithReactiveInput<TResult>(initialQueryResults)

  React.useEffect(() => {
    const liveStoreQuery = makeLiveStoreQuery()
    const unsubscribe = store.subscribe(
      liveStoreQuery,
      (results) => {
        if (isEqual(results, queryResultsRef.current) === false) {
          setQueryResults_(results)
        }
      },
      undefined,
      { label: `useGraphQL:query:subscribe:${liveStoreQuery.label}` },
    )

    return () => {
      unsubscribe()
    }
    // NOTE `setQueryResults_` from the deps array as it seems to cause an infinite loop
    // This should probably be improved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    otelCtx,
    makeLiveStoreQuery,
    // setQueryResults_,
    store,
  ])

  // Very important: remove any queries / other resources associated w/ this component
  React.useEffect(() => () => store.unmountComponent(componentKey), [store, componentKey])

  return queryResultsRef.current
}
