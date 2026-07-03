import type { Store } from '@livestore/livestore'

import {
  ensureClientDocumentsSync,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSyncSpec,
} from './ensure-client-document.ts'
import { withTraceSpan } from './otel.ts'

/** Example-local sync hook for ensuring client documents before descendants read them. */
export function useEnsureClientDocuments(
  store: Store<any, any>,
  documents: readonly EnsureClientDocumentSyncSpec<any>[],
): readonly EnsureClientDocumentResult[] {
  return withTraceSpan(
    'client_document.sync_hook.ensure',
    {
      'client_document.ensure.count': documents.length,
      'client_document.sync_hook.key': getDocumentsKey(documents),
    },
    () => ensureClientDocumentsSync(store, documents),
  )
}

function getDocumentsKey(documents: readonly EnsureClientDocumentSyncSpec<any>[]): string {
  return documents
    .map((document) => `${document.table.sqliteDef.name}:${String(document.id ?? '<default-id>')}`)
    .join('|')
}
