import type { LiveQuery, LiveQueryDef, SignalDef } from '@livestore/livestore'

/**
 * Normalized representation of a queryable for internal processing.
 * Either a definition (LiveQueryDef/SignalDef) or an already-instantiated LiveQuery.
 */
export type NormalizedQueryable<TResult> =
  | { _tag: 'definition'; def: LiveQueryDef<TResult> | SignalDef<TResult> }
  | { _tag: 'live-query'; query$: LiveQuery<TResult> }
