import type { Store } from '@livestore/livestore'

import {
  ensureClientDocumentSync,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSyncSpec,
} from './ensure-client-document.ts'
import { withTraceSpan } from './otel.ts'

/** Example-local sync hook for ensuring one client document before descendants read it. */
export function useEnsureClientDocument(
  store: Store<any, any>,
  document: EnsureClientDocumentSyncSpec<any>,
): EnsureClientDocumentResult {
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
