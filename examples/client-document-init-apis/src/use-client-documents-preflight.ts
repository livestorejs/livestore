import type { Store } from '@livestore/livestore'
import React from 'react'

import {
  ensureClientDocuments,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSpec,
} from './ensure-client-document.ts'

type Resource =
  | { readonly status: 'pending'; readonly promise: Promise<readonly EnsureClientDocumentResult[]> }
  | { readonly status: 'fulfilled'; readonly value: readonly EnsureClientDocumentResult[] }
  | { readonly status: 'rejected'; readonly error: unknown }

const preflightCache = new WeakMap<Store<any, any>, Map<string, Resource>>()

/** Example-local Suspense hook for ensuring client documents before descendants render. */
export function useClientDocumentsPreflight(
  store: Store<any, any>,
  documents: readonly EnsureClientDocumentSpec<any>[],
): readonly EnsureClientDocumentResult[] {
  const key = React.useMemo(() => getDocumentsKey(documents), [documents])
  const resource = getPreflightResource(store, key, documents)

  switch (resource.status) {
    case 'fulfilled':
      return resource.value
    case 'rejected':
      throw resource.error
    case 'pending':
      throw resource.promise
  }
}

function getPreflightResource(
  store: Store<any, any>,
  key: string,
  documents: readonly EnsureClientDocumentSpec<any>[],
): Resource {
  let storeCache = preflightCache.get(store)
  if (storeCache === undefined) {
    storeCache = new Map()
    preflightCache.set(store, storeCache)
  }

  const cached = storeCache.get(key)
  if (cached !== undefined) return cached

  const promise = ensureClientDocuments(store, documents)
  const resource: Resource = { status: 'pending', promise }
  storeCache.set(key, resource)
  promise.then(
    (value) => storeCache.set(key, { status: 'fulfilled', value }),
    (error: unknown) => storeCache.set(key, { status: 'rejected', error }),
  )

  return resource
}

function getDocumentsKey(documents: readonly EnsureClientDocumentSpec<any>[]): string {
  return documents.map((document) => {
    const defaultKey = typeof document.default === 'function' ? 'fn' : JSON.stringify(document.default)
    return `${document.table.sqliteDef.name}:${document.id ?? '<default-id>'}:${document.label ?? ''}:${defaultKey}`
  }).join('|')
}
