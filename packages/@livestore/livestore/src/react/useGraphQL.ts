// TODO get rid of this hook altogether
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import * as otel from '@opentelemetry/api'
import { isEqual } from 'lodash-es'
import React from 'react'

import { labelForKey } from '../componentKey.js'
import { queryGraphQL } from '../reactiveQueries/graphql.js'
import { useStore } from './LiveStoreContext.js'
import { type ComponentKeyConfig, useComponentKey } from './useComponentState.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

export type UseComponentStateProps<TResult extends Record<string, any>, TVariables extends Record<string, any>> = {
  query: DocumentNode<TResult, TVariables>
  variables: TVariables
  componentKey: ComponentKeyConfig
  reactDeps?: React.DependencyList
}

type Variables = Record<string, any>

// TODO get rid of the query cache in favour of the new side-effect-free query definition approach https://www.notion.so/schickling/New-query-definition-approach-1097a78ef0e9495bac25f90417374756?pvs=4
// NOTE we're using a nested map here since we need to resolve 2 levels of object identities (query + variables)
// const queryCache = new Map<DocumentNode<any, any>, Map<Variables, LiveStoreGraphQLQuery<any, any, any>>>()

/**
 * This is needed because the `React.useMemo` call below, can sometimes be called multiple times 🤷,
 * so we need to "cache" the fact that we've already started a span for this component.
 * The map entry is being removed again in the `React.useEffect` call below.
 */
const spanAlreadyStartedCache = new Map<string, { span: otel.Span; otelContext: otel.Context }>()

// TODO 1) figure out a way to make `variables` optional if the query doesn't have any variables (probably requires positional args)
// TODO 2) allow `.pipe` on the resulting query (possibly as a separate optional prop)
export const useGraphQL = <TResult extends Record<string, any>, TVariables extends Variables = {}>({
  query: document,
  variables,
  componentKey: componentKeyConfig,
  reactDeps = [],
}: UseComponentStateProps<TResult, TVariables>): Readonly<TResult> => {
  const componentKey = useComponentKey(componentKeyConfig, reactDeps)
  const { store } = useStore()

  const componentKeyLabel = React.useMemo(() => labelForKey(componentKey), [componentKey])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelContext } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(componentKeyLabel)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useGraphQL:${componentKeyLabel}`,
      {},
      store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    spanAlreadyStartedCache.set(componentKeyLabel, { span, otelContext })

    return { span, otelContext }
  }, [componentKeyLabel, store.otel.queriesSpanContext, store.otel.tracer])

  React.useEffect(
    () => () => {
      spanAlreadyStartedCache.delete(componentKeyLabel)
      span.end()
    },
    [componentKeyLabel, span],
  )

  const liveStoreQuery = React.useMemo(
    () => {
      return queryGraphQL(document, () => variables ?? ({} as TVariables), {
        /* componentKey,  */
      })

      // NOTE I had to disable the caching below as still led to many problems
      // We should just implement the new query definition approach instead

      // const queryCacheForQuery = queryCache.get(query)
      // if (queryCacheForQuery && queryCacheForQuery.has(variables)) {
      //   return queryCacheForQuery.get(variables)!
      // }

      // const newQuery = store.queryGraphQL(query, () => variables ?? ({} as TVariables), { componentKey, otelContext })

      // if (queryCacheForQuery) {
      //   queryCacheForQuery.set(variables, newQuery)
      // } else {
      //   queryCache.set(query, new Map([[variables, newQuery]]))
      // }

      // return newQuery
    },
    // NOTE: we don't include the queries function passed in by the user here;
    // the reason is that we don't want to force them to memoize that function.
    // Instead, we just assume that the function always has the same contents.
    // This makes sense for LiveStore because the component config should be static.
    // TODO: document this and consider whether it's the right API surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [componentKey, store],
  )

  // TODO get rid of the temporary query workaround
  const initialQueryResults = React.useMemo(() => liveStoreQuery.run(), [liveStoreQuery])

  const [queryResultsRef, setQueryResults_] = useStateRefWithReactiveInput<TResult>(initialQueryResults)

  React.useEffect(() => {
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
    liveStoreQuery,
    // setQueryResults_,
    store,
  ])

  // Very important: remove any queries / other resources associated w/ this component
  React.useEffect(() => () => liveStoreQuery.destroy(), [liveStoreQuery])

  return queryResultsRef.current
}
