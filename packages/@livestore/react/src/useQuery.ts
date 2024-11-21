import type { GetResult, LiveQueryAny } from '@livestore/livestore'
import { extractStackInfoFromStackTrace, stackInfoToString } from '@livestore/livestore'
import { deepEqual, indent } from '@livestore/utils'
import * as otel from '@opentelemetry/api'
import React from 'react'

import { useStore } from './LiveStoreContext.js'
import { originalStackLimit } from './utils/stack-info.js'
import { useStateRefWithReactiveInput } from './utils/useStateRefWithReactiveInput.js'

/**
 * NOTE Some folks have suggested to use `React.useSyncExternalStore`, however, it's not doing anything special
 * for what's needed here, so we handle everything manually.
 */

/**
 * This is needed because the `React.useMemo` call below, can sometimes be called multiple times 🤷,
 * so we need to "cache" the fact that we've already started a span for this component.
 * The map entry is being removed again in the `React.useEffect` call below.
 */
const spanAlreadyStartedCache = new Map<LiveQueryAny, { span: otel.Span; otelContext: otel.Context }>()

export const useQuery = <TQuery extends LiveQueryAny>(query: TQuery): GetResult<TQuery> => useQueryRef(query).current

/**
 *
 */
export const useQueryRef = <TQuery extends LiveQueryAny>(
  query$: TQuery,
  parentOtelContext?: otel.Context,
): React.MutableRefObject<GetResult<TQuery>> => {
  const { store } = useStore()

  React.useDebugValue(`LiveStore:useQuery:${query$.id}:${query$.label}`)
  // console.debug(`LiveStore:useQuery:${query$.id}:${query$.label}`)

  const stackInfo = React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])

  // The following `React.useMemo` and `React.useEffect` calls are used to start and end a span for the lifetime of this component.
  const { span, otelContext } = React.useMemo(() => {
    const existingSpan = spanAlreadyStartedCache.get(query$)
    if (existingSpan !== undefined) return existingSpan

    const span = store.otel.tracer.startSpan(
      `LiveStore:useQuery:${query$.label}`,
      { attributes: { label: query$.label, stackInfo: JSON.stringify(stackInfo) } },
      parentOtelContext ?? store.otel.queriesSpanContext,
    )

    const otelContext = otel.trace.setSpan(otel.context.active(), span)

    spanAlreadyStartedCache.set(query$, { span, otelContext })

    return { span, otelContext }
  }, [parentOtelContext, query$, stackInfo, store.otel.queriesSpanContext, store.otel.tracer])

  const initialResult = React.useMemo(() => {
    try {
      return query$.run(otelContext, {
        _tag: 'react',
        api: 'useQuery',
        label: query$.label,
        stackInfo,
      })
    } catch (cause: any) {
      throw new Error(
        `\
[@livestore/react:useQuery] Error running query: ${cause.name}

Query: ${query$.label}

React trace:

${indent(stackInfoToString(stackInfo), 4)}

Stack trace:
`,
        { cause },
      )
    }
  }, [otelContext, query$, stackInfo])

  // We know the query has a result by the time we use it; so we can synchronously populate a default state
  const [valueRef, setValue] = useStateRefWithReactiveInput<GetResult<TQuery>>(initialResult)

  React.useEffect(
    () => () => {
      spanAlreadyStartedCache.delete(query$)
      span.end()
    },
    [query$, span],
  )

  // Subscribe to future updates for this query
  React.useEffect(() => {
    query$.activeSubscriptions.add(stackInfo)

    // Dynamic queries only set their actual label after they've been run the first time,
    // so we're also updating the span name here.
    span.updateName(`LiveStore:useQuery:${query$.label}`)

    return store.subscribe(
      query$,
      (newValue) => {
        // NOTE: we return a reference to the result object within LiveStore;
        // this implies that app code must not mutate the results, or else
        // there may be weird reactivity bugs.
        if (deepEqual(newValue, valueRef.current) === false) {
          setValue(newValue)
        }
      },
      () => {
        query$.activeSubscriptions.delete(stackInfo)
      },
      { label: query$.label, otelContext },
    )
  }, [stackInfo, query$, setValue, store, valueRef, otelContext, span])

  return valueRef
}
