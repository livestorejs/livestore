import { State, type Store } from '@livestore/livestore'

import { withTraceSpan } from '../../otel.ts'
import {
  ensureDerivedClientDocumentAsync,
  type EnsureDerivedClientDocumentAsyncOptions,
  type EnsureDerivedClientDocumentAsyncResult,
} from './ensure-derived-client-document-async.ts'

type Resource<T> =
  | { readonly status: 'pending'; readonly promise: PromiseLike<T> }
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }

const suspenseCache = new WeakMap<Store<any, any>, Map<string, Resource<unknown>>>()

/** Example-local Suspense hook for one async derived default gated by app-level source readiness. */
export function useEnsureDerivedClientDocumentAsyncSuspense<TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  store: Store<any, any>,
  options: EnsureDerivedClientDocumentAsyncOptions<TTable>,
): EnsureDerivedClientDocumentAsyncResult<TTable['Value']> {
  // Don't suspend before source data is ready. In this example the source key is
  // created by component state; suspending before the first commit would discard
  // that state and generate a new key on every retry.
  if (options.sourceReady === false) {
    return { sourceReady: false }
  }

  const key = `derived:${getDocumentKey(options.document)}`
  return readResource(getSuspenseResource(store, key, () => ensureDerivedClientDocumentAsync(store, options)))
}

function getSuspenseResource<T>(store: Store<any, any>, key: string, makePromise: () => PromiseLike<T>): Resource<T> {
  let storeCache = suspenseCache.get(store)
  if (storeCache === undefined) {
    storeCache = new Map()
    suspenseCache.set(store, storeCache)
  }

  const cached = storeCache.get(key) as Resource<T> | undefined
  if (cached !== undefined) {
    withTraceSpan(
      'client_document.suspense.cache',
      {
        'client_document.suspense.key': key,
        'client_document.suspense.cache_hit': true,
        'client_document.suspense.status': cached.status,
      },
      () => undefined,
    )
    return cached
  }

  const promise = withTraceSpan(
    'client_document.suspense.ensure.async',
    { 'client_document.suspense.key': key, 'client_document.suspense.cache_hit': false },
    (span) => {
      span.setAttribute('client_document.suspense.result', 'promise')
      return makePromise()
    },
  )
  const resource: Resource<T> = { status: 'pending', promise }
  storeCache.set(key, resource as Resource<unknown>)
  promise.then(
    (value) => storeCache.set(key, { status: 'fulfilled', value }),
    (error: unknown) => storeCache.set(key, { status: 'rejected', error }),
  )

  return resource
}

function readResource<T>(resource: Resource<T>): T {
  switch (resource.status) {
    case 'fulfilled':
      return resource.value
    case 'rejected':
      throw resource.error
    case 'pending':
      throw resource.promise
  }
}

function getDocumentKey<TTable extends State.SQLite.ClientDocumentTableDef.Any>(
  document: EnsureDerivedClientDocumentAsyncOptions<TTable>['document'],
): string {
  const defaultKey = typeof document.default === 'function' ? 'fn' : JSON.stringify(document.default)
  return [
    document.table.sqliteDef.name,
    String(document.id ?? '<default-id>'),
    document.label ?? '',
    defaultKey,
  ].join(':')
}
