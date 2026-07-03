import { State, type Store } from '@livestore/livestore'

import { withTraceSpan } from '../../otel.ts'
import {
  ensureClientDocumentAsync,
  type EnsureClientDocumentAsyncResult,
  type EnsureClientDocumentAsyncSpec,
} from './ensure-client-document-async.ts'

export interface EnsureDerivedClientDocumentAsyncOptions<
  TTable extends State.SQLite.ClientDocumentTableDef.Any = State.SQLite.ClientDocumentTableDef.Any,
> {
  readonly sourceReady: boolean
  readonly document: EnsureClientDocumentAsyncSpec<TTable>
}

export type EnsureDerivedClientDocumentAsyncResult<TValue = unknown> =
  | { readonly sourceReady: false }
  | { readonly sourceReady: true; readonly result: EnsureClientDocumentAsyncResult<TValue> }

/**
 * Ensures a derived client document after app-level source data is ready.
 *
 * This API is explicitly async: callers that need render-time sync behavior should
 * use the sync module instead of relying on this helper.
 */
export const ensureDerivedClientDocumentAsync = async <TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  options: EnsureDerivedClientDocumentAsyncOptions<TTable>,
): Promise<EnsureDerivedClientDocumentAsyncResult<TTable['Value']>> => {
  return withTraceSpan(
    'client_document.ensure_derived.async',
    { 'client_document.derived.source_ready': options.sourceReady },
    async () => {
      if (options.sourceReady === false) {
        return { sourceReady: false }
      }

      return { sourceReady: true, result: await ensureClientDocumentAsync(store, options.document) }
    },
  )
}
