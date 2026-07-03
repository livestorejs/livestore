import type { Store } from '@livestore/livestore'
import React from 'react'

import {
  ensureClientDocumentsSyncOrPromise,
  ensureDerivedClientDocumentsExistSyncOrPromise,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSpec,
  type EnsureDerivedClientDocumentsExistResult,
} from './ensure-client-document.ts'
import { withTraceSpan } from './otel.ts'

type Resource<T> =
  | { readonly status: 'pending'; readonly promise: PromiseLike<T> }
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }

const suspenseCache = new WeakMap<Store<any, any>, Map<string, Resource<unknown>>>()

/** Example-local Suspense hook for ensuring client documents before descendants render. */
export function useEnsureClientDocumentsSuspense(
  store: Store<any, any>,
  documents: readonly EnsureClientDocumentSpec<any>[],
): readonly EnsureClientDocumentResult[] {
  const key = React.useMemo(() => `static:${getDocumentsKey(documents)}`, [documents])
  const resource = getSuspenseResource(store, key, () => ensureClientDocumentsSyncOrPromise(store, documents))

  return readResource(resource)
}

/** Example-local Suspense hook for derived defaults gated by app-level source readiness. */
export function useEnsureDerivedClientDocumentsSuspense(
  store: Store<any, any>,
  options: { readonly sourceReady: boolean; readonly documents: readonly EnsureClientDocumentSpec<any>[] },
): EnsureDerivedClientDocumentsExistResult {
  // Don't suspend before source data is ready. In this example the source key is
  // created by component state; suspending before the first commit would discard
  // that state and generate a new key on every retry.
  if (options.sourceReady === false) {
    return { sourceReady: false, results: [] }
  }

  const key = `derived:${getDocumentsKey(options.documents)}`
  const resource = getSuspenseResource(store, key, () =>
    ensureDerivedClientDocumentsExistSyncOrPromise(store, options),
  )

  return readResource(resource)
}

function getSuspenseResource<T>(store: Store<any, any>, key: string, makeValue: () => T | PromiseLike<T>): Resource<T> {
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

  const valueOrPromise = withTraceSpan(
    'client_document.suspense.ensure',
    { 'client_document.suspense.key': key, 'client_document.suspense.cache_hit': false },
    (span) => {
      const value = makeValue()
      span.setAttribute('client_document.suspense.result', isPromiseLike(value) ? 'promise' : 'sync')
      return value
    },
  )
  if (isPromiseLike(valueOrPromise) === false) {
    const resource: Resource<T> = { status: 'fulfilled', value: valueOrPromise as T }
    storeCache.set(key, resource as Resource<unknown>)
    return resource
  }

  const promise = valueOrPromise as PromiseLike<T>
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

function getDocumentsKey(documents: readonly EnsureClientDocumentSpec<any>[]): string {
  return documents.map((document) => {
    const defaultKey = typeof document.default === 'function' ? 'fn' : JSON.stringify(document.default)
    return `${document.table.sqliteDef.name}:${String(document.id ?? '<default-id>')}:${document.label ?? ''}:${defaultKey}`
  }).join('|')
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<Awaited<T>> {
  return typeof value === 'object' && value !== null && 'then' in value
}
