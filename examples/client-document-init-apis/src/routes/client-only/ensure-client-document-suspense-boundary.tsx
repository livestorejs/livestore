import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import type { EnsureClientDocumentSpec } from '../../ensure-client-document.ts'
import { tables } from '../../schema.ts'
import { useEnsureClientDocumentsSuspense } from '../../use-ensure-client-documents-suspense.ts'

const documentId = 'suspense-boundary:inbox'

export const Route = createFileRoute('/client-only/ensure-client-document-suspense-boundary')({
  component: EnsureClientDocumentSuspenseBoundaryPage,
})

function EnsureClientDocumentSuspenseBoundaryPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  return (
    <EnsureClientDocumentSuspenseBoundary
      store={store}
      documents={[
        {
          table: tables.threadListUi,
          id: documentId,
          default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
          label: 'suspense-boundary:thread-list-ui',
        },
      ]}
    >
      <DemoFrame store={store} title="<EnsureClientDocumentSuspenseBoundary>" documentId={documentId}>
        <div className="card">
          <p>Children do not render until the Suspense boundary has ensured the client document.</p>
        </div>
        <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
      </DemoFrame>
    </EnsureClientDocumentSuspenseBoundary>
  )
}

/** Route-local Suspense boundary for this exploration. */
function EnsureClientDocumentSuspenseBoundary({
  store,
  documents,
  children,
}: {
  readonly store: DemoStore
  readonly documents: readonly EnsureClientDocumentSpec<typeof tables.threadListUi>[]
  readonly children: React.ReactNode
}) {
  useEnsureClientDocumentsSuspense(store, documents)
  return children
}
