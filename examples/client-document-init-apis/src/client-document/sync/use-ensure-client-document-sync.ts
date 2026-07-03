import type { Store } from '@livestore/livestore'

import { withTraceSpan } from '../../otel.ts'
import {
  ensureClientDocumentSync,
  type EnsureClientDocumentSyncResult,
  type EnsureClientDocumentSyncSpec,
} from './ensure-client-document-sync.ts'

/** Example-local sync hook for ensuring one client document before descendants read it. */
export function useEnsureClientDocumentSync(
  store: Store<any, any>,
  document: EnsureClientDocumentSyncSpec<any>,
): EnsureClientDocumentSyncResult {
  return withTraceSpan(
    'client_document.sync_hook.ensure',
    {
      'client_document.sync_hook.key': getDocumentKey(document),
    },
    () => ensureClientDocumentSync(store, document),
  )
}

function getDocumentKey(document: EnsureClientDocumentSyncSpec<any>): string {
  return `${document.table.sqliteDef.name}:${String(document.id ?? '<default-id>')}`
}
