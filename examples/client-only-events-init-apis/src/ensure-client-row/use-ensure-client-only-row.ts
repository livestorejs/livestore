import {
  ensureClientOnlyRow,
  type EnsureClientOnlyRowOptions,
  type EnsureClientOnlyRowResult,
} from './ensure-client-only-row.ts'

export interface UseEnsureClientOnlyRowOptions {
  readonly enabled?: boolean
}

export type UseEnsureClientOnlyRowResult<TRow> =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: EnsureClientOnlyRowResult<TRow> }

/**
 * Runs an explicit ensure operation during render when enabled.
 *
 * The options keep the passive read and explicit client-only ensure event visible
 * at the callsite instead of hiding them behind a React-specific wrapper.
 */
export function useEnsureClientOnlyRow<TRow, TDefault>(
  ensureOptions: EnsureClientOnlyRowOptions<TRow, TDefault>,
  options: UseEnsureClientOnlyRowOptions = {},
): UseEnsureClientOnlyRowResult<TRow> {
  const enabled = options.enabled ?? true

  if (enabled === false) {
    return { status: 'skipped' }
  }

  return { status: 'ensured', result: ensureClientOnlyRow(ensureOptions) }
}
