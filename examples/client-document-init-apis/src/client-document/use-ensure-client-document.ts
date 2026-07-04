import { State, type Store } from '@livestore/livestore'

import {
  ensureClientDocument,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSpec,
} from './ensure-client-document.ts'

export interface UseEnsureClientDocumentOptions {
  readonly enabled?: boolean
}

export type UseEnsureClientDocumentResult<TValue = unknown> =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: EnsureClientDocumentResult<TValue> }

/** Example-local hook for ensuring one client document before descendants read it. */
export function useEnsureClientDocument<TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  document: EnsureClientDocumentSpec<TTable>,
  options: UseEnsureClientDocumentOptions = {},
): UseEnsureClientDocumentResult<TTable['Value']> {
  const enabled = options.enabled ?? true

  if (enabled === false) {
    return { status: 'skipped' }
  }

  return { status: 'ensured', result: ensureClientDocument(store, document) }
}
