import type { LiveStoreEvent } from '@livestore/livestore'

import {
  ensureClientOnlyRow,
  type EnsureClientOnlyRowOptions,
  type EnsureClientOnlyRowResult,
  type EnsureClientOnlyRowTable,
} from './ensure-client-only-row.ts'

export interface UseEnsureClientOnlyRowOptions {
  readonly enabled?: boolean
}

export type UseEnsureClientOnlyRowResult<TTable extends EnsureClientOnlyRowTable> =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: EnsureClientOnlyRowResult<TTable> }

/**
 * Runs an explicit ensure operation during render when enabled.
 *
 * The options keep the explicit client-only ensure event visible at the
 * callsite instead of hiding it behind a React-specific wrapper.
 */
export function useEnsureClientOnlyRow<
  TTable extends EnsureClientOnlyRowTable,
  TDefault,
  TEvent extends LiveStoreEvent.Input.Decoded,
>(
  ensureOptions: EnsureClientOnlyRowOptions<TTable, TDefault, TEvent>,
  options: UseEnsureClientOnlyRowOptions = {},
): UseEnsureClientOnlyRowResult<TTable> {
  const enabled = options.enabled ?? true

  if (enabled === false) {
    return { status: 'skipped' }
  }

  return { status: 'ensured', result: ensureClientOnlyRow(ensureOptions) }
}
