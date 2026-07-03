import { State, type Store } from '@livestore/livestore'

import { withTraceSpan } from '../../otel.ts'
import {
  ensureClientDocumentSync,
  type EnsureClientDocumentSyncResult,
  type EnsureClientDocumentSyncSpec,
} from './ensure-client-document-sync.ts'

export interface UseEnsureClientDocumentSyncOptions {
  readonly enabled?: boolean
}

export type UseEnsureClientDocumentSyncResult<TValue = unknown> =
  | { readonly status: 'skipped' }
  | { readonly status: 'ensured'; readonly result: EnsureClientDocumentSyncResult<TValue> }

/** Example-local sync hook for ensuring one client document before descendants read it. */
export function useEnsureClientDocumentSync<TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  document: EnsureClientDocumentSyncSpec<TTable>,
  options: UseEnsureClientDocumentSyncOptions = {},
): UseEnsureClientDocumentSyncResult<TTable['Value']> {
  const enabled = options.enabled ?? true

  return withTraceSpan(
    'client_document.sync_hook.ensure',
    {
      'client_document.sync_hook.key': getDocumentKey(document),
      'client_document.sync_hook.enabled': enabled,
    },
    () => {
      if (enabled === false) {
        return { status: 'skipped' }
      }

      return { status: 'ensured', result: ensureClientDocumentSync(store, document) }
    },
  )
}

function getDocumentKey<TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  document: EnsureClientDocumentSyncSpec<TTable>,
): string {
  return `${document.table.sqliteDef.name}:${String(document.id ?? '<default-id>')}`
}
