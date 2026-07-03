import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, type DemoStore, ThreadList } from '../components/DemoFrame.tsx'
import {
  ensureClientDocuments,
  type EnsureClientDocumentResult,
  type EnsureClientDocumentSpec,
} from '../ensure-client-document.ts'
import { tables } from '../schema.ts'

const documentId = 'component-preflight:inbox'

export const Route = createFileRoute('/02-client-document-preflight')({
  component: ComponentPreflightPage,
})

function ComponentPreflightPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  return (
    <ClientDocumentPreflight
      store={store}
      documents={[
        {
          table: tables.threadListUi,
          id: documentId,
          default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
          label: 'component-preflight:thread-list-ui',
        },
      ]}
    >
      <DemoFrame store={store} title="<ClientDocumentPreflight>" documentId={documentId}>
        <div className="card">
          <p>Children do not render until the preflight boundary resolves.</p>
        </div>
        <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
      </DemoFrame>
    </ClientDocumentPreflight>
  )
}

/** Route-local Suspense boundary for this exploration. */
function ClientDocumentPreflight({
  store,
  documents,
  children,
}: {
  readonly store: DemoStore
  readonly documents: readonly EnsureClientDocumentSpec<typeof tables.threadListUi>[]
  readonly children: React.ReactNode
}) {
  useClientDocumentsPreflight(store, documents)
  return children
}

type Resource =
  | { readonly status: 'pending'; readonly promise: Promise<readonly EnsureClientDocumentResult[]> }
  | { readonly status: 'fulfilled'; readonly value: readonly EnsureClientDocumentResult[] }
  | { readonly status: 'rejected'; readonly error: unknown }

const preflightCache = new WeakMap<DemoStore, Map<string, Resource>>()

function useClientDocumentsPreflight(
  store: DemoStore,
  documents: readonly EnsureClientDocumentSpec<typeof tables.threadListUi>[],
) {
  const key = React.useMemo(() => documents.map((_) => `${_.table.sqliteDef.name}:${_.id}:${JSON.stringify(_.default)}`).join('|'), [documents])
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
  store: DemoStore,
  key: string,
  documents: readonly EnsureClientDocumentSpec<typeof tables.threadListUi>[],
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
