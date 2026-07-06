import { type Store } from '@livestore/livestore'

import { schema } from '../schema.ts'
import {
  ensureThreadListUi,
  type EnsureThreadListUiResult,
  type EnsureThreadListUiSpec,
} from './ensure-thread-list-ui.ts'

export interface UseEnsureThreadListUiOptions {
  readonly enabled?: boolean
}

export type UseEnsureThreadListUiResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: EnsureThreadListUiResult }

/** Example-local hook for ensuring one client-only UI row before descendants read it. */
export function useEnsureThreadListUi(
  store: Store<typeof schema>,
  row: EnsureThreadListUiSpec,
  options: UseEnsureThreadListUiOptions = {},
): UseEnsureThreadListUiResult {
  const enabled = options.enabled ?? true

  if (enabled === false) {
    return { status: 'skipped' }
  }

  return { status: 'ensured', result: ensureThreadListUi(store, row) }
}
