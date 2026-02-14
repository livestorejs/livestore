import * as otel from '@opentelemetry/api'

import { isQueryBuilder } from '@livestore/common'
import type { LiveQuery, LiveQueryDef, Queryable, SignalDef, StackInfo, Store } from '@livestore/livestore'
import { isQueryable, queryDb, StoreInternalsSymbol, stackInfoToString } from '@livestore/livestore'
import type { LiveQueries } from '@livestore/livestore/internal'
import { indent, shouldNeverHappen } from '@livestore/utils'

import type { NormalizedQueryable } from './types.ts'

/**
 * Normalizes a queryable into a standard internal representation.
 *
 * Handles:
 * - QueryBuilder → wraps in queryDb() and returns as definition
 * - LiveQueryDef/SignalDef → returns as definition
 * - LiveQuery instance → returns as live-query
 *
 * @throws If the input is not a valid Queryable
 */
export const normalizeQueryable = <TResult>(queryable: Queryable<TResult>): NormalizedQueryable<TResult> => {
  if (!isQueryable(queryable)) {
    return shouldNeverHappen('Expected a Queryable value')
  }

  if (isQueryBuilder(queryable)) {
    return { _tag: 'definition', def: queryDb(queryable) }
  }

  if (
    (queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'def' ||
    (queryable as LiveQueryDef<TResult> | SignalDef<TResult>)._tag === 'signal-def'
  ) {
    return { _tag: 'definition', def: queryable as LiveQueryDef<TResult> | SignalDef<TResult> }
  }

  return { _tag: 'live-query', query$: queryable as LiveQuery<TResult> }
}

/**
 * Computes a unique key for reference-counted query caching.
 *
 * The key includes all aspects of a store instance (storeId, clientId, sessionId)
 * to prevent unexpected cache mappings across different store instances.
 *
 * @param store - The store instance
 * @param normalized - The normalized queryable
 * @returns A unique string key for caching
 */
export const computeRcRefKey = <TResult>(store: Store, normalized: NormalizedQueryable<TResult>): string => {
  const base = `${store.storeId}_${store.clientId}_${store.sessionId}`

  if (normalized._tag === 'definition') {
    return `${base}:def:${normalized.def.hash}`
  }

  return `${base}:instance:${normalized.query$.id}`
}

/**
 * Formats a query error with additional context for debugging.
 *
 * @param cause - The original error
 * @param label - The query label
 * @param stackInfo - Stack information for tracing
 * @param framework - The framework name (e.g., 'react', 'solid')
 * @returns A formatted Error with enhanced message
 */
export const formatQueryError = (
  cause: Error,
  label: string,
  stackInfo: StackInfo,
  framework: 'react' | 'solid' | 'svelte' | string,
): Error => {
  return new Error(
    `\
[@livestore/${framework}:useQuery] Error running query: ${cause.name}

Query: ${label}

${framework.charAt(0).toUpperCase() + framework.slice(1)} trace:

${indent(stackInfoToString(stackInfo), 4)}

Stack trace:
`,
    { cause },
  )
}

/**
 * Runs the initial query and returns the result.
 * Handles errors by formatting them with framework-specific context.
 *
 * @param query$ - The live query to run
 * @param otelContext - OpenTelemetry context for tracing
 * @param stackInfo - Stack information for debugging
 * @param framework - The framework name (e.g., 'react', 'solid')
 * @returns The query result
 * @throws Formatted error if the query fails
 */
export const runInitialQuery = <TResult>(
  query$: LiveQuery<TResult>,
  otelContext: otel.Context,
  stackInfo: StackInfo,
  framework: 'react' | 'solid' | 'svelte' | string,
): TResult => {
  try {
    return query$.run({
      otelContext,
      debugRefreshReason: {
        // NOTE: The RefreshReason type currently only supports 'react' for this variant.
        // See TODO in store-types.ts to rename this to be framework-agnostic.
        _tag: 'react' as const,
        api: 'useQuery',
        label: `useQuery:initial-run:${query$.label}`,
        stackInfo,
      },
    })
  } catch (cause: any) {
    console.error(`[@livestore/${framework}:useQuery] Error running query`, cause)
    throw formatQueryError(cause, query$.label, stackInfo, framework)
  }
}

/**
 * Gets the label from a normalized queryable.
 */
export const getResourceLabel = <TResult>(normalized: NormalizedQueryable<TResult>): string =>
  normalized._tag === 'definition' ? normalized.def.label : normalized.query$.label

/**
 * Creates the query resource (span, otelContext, queryRcRef) from a normalized queryable.
 * This is the common factory logic shared between React and Solid hooks.
 */
export const createQueryResource = <TResult>(
  store: Store,
  normalized: NormalizedQueryable<TResult>,
  stackInfo: StackInfo,
  options?: {
    otelSpanName?: string | undefined
    otelContext?: otel.Context | undefined
  },
): {
  queryRcRef: LiveQueries.RcRef<LiveQuery<TResult>>
  span: otel.Span
  otelContext: otel.Context
} => {
  const resourceLabel = getResourceLabel(normalized)

  const span = store[StoreInternalsSymbol].otel.tracer.startSpan(
    options?.otelSpanName ?? `LiveStore:useQuery:${resourceLabel}`,
    { attributes: { label: resourceLabel, firstStackInfo: JSON.stringify(stackInfo) } },
    options?.otelContext ?? store[StoreInternalsSymbol].otel.queriesSpanContext,
  )

  const otelContext = otel.trace.setSpan(otel.context.active(), span)

  const queryRcRef =
    normalized._tag === 'definition'
      ? normalized.def.make(store[StoreInternalsSymbol].reactivityGraph.context!, otelContext)
      : ({
          value: normalized.query$,
          deref: () => {},
          rc: Number.POSITIVE_INFINITY,
        } satisfies LiveQueries.RcRef<LiveQuery<TResult>>)

  return { queryRcRef, span, otelContext }
}
