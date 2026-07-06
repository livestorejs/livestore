export interface UseEnsureClientOnlyRowOptions {
  readonly enabled?: boolean
}

export type UseEnsureClientOnlyRowResult<TResult> =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: TResult }

/**
 * Runs an explicit ensure operation during render when enabled.
 *
 * The ensure function should be synchronous and idempotent: read first, commit a
 * client-only ensure event only if missing, then read again.
 */
export function useEnsureClientOnlyRow<TResult>(
  ensure: () => TResult,
  options: UseEnsureClientOnlyRowOptions = {},
): UseEnsureClientOnlyRowResult<TResult> {
  const enabled = options.enabled ?? true

  if (enabled === false) {
    return { status: 'skipped' }
  }

  return { status: 'ensured', result: ensure() }
}
