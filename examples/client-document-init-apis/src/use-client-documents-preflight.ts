import type { Store } from '@livestore/livestore'
import React from 'react'

import {
  ensureClientDocuments,
  ensureDerivedClientDocumentsExist,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSpec,
  type EnsureDerivedClientDocumentsExistResult,
} from './ensure-client-document.ts'

type Resource<T> =
  | { readonly status: 'pending'; readonly promise: Promise<T> }
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }

const preflightCache = new WeakMap<Store<any, any>, Map<string, Resource<unknown>>>()

/** Example-local Suspense hook for ensuring client documents before descendants render. */
export function useClientDocumentsPreflight(
  store: Store<any, any>,
  documents: readonly EnsureClientDocumentSpec<any>[],
): readonly EnsureClientDocumentResult[] {
  const key = React.useMemo(() => `static:${getDocumentsKey(documents)}`, [documents])
  const resource = getPreflightResource(store, key, () => ensureClientDocuments(store, documents))

  return readResource(resource)
}

/** Example-local Suspense hook for derived defaults gated by app-level source readiness. */
export function useDerivedClientDocumentsPreflight(
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
  const resource = getPreflightResource(store, key, () => ensureDerivedClientDocumentsExist(store, options))

  return readResource(resource)
}

function getPreflightResource<T>(store: Store<any, any>, key: string, makePromise: () => Promise<T>): Resource<T> {
  let storeCache = preflightCache.get(store)
  if (storeCache === undefined) {
    storeCache = new Map()
    preflightCache.set(store, storeCache)
  }

  const cached = storeCache.get(key) as Resource<T> | undefined
  if (cached !== undefined) return cached

  const promise = makePromise()
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
    return `${document.table.sqliteDef.name}:${document.id ?? '<default-id>'}:${document.label ?? ''}:${defaultKey}`
  }).join('|')
}
