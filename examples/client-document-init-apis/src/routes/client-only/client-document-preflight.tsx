import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import type { EnsureClientDocumentSpec } from '../../ensure-client-document.ts'
import { tables } from '../../schema.ts'
import { useClientDocumentsPreflight } from '../../use-client-documents-preflight.ts'

const documentId = 'component-preflight:inbox'

export const Route = createFileRoute('/client-only/client-document-preflight')({
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
