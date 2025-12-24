import { isQueryBuilder } from '@livestore/common'
import type { LiveQuery, LiveQueryDef, Queryable, SignalDef, StackInfo, Store } from '@livestore/livestore'
import { isQueryable, queryDb, stackInfoToString } from '@livestore/livestore'
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
