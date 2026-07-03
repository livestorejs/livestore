import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

import { DemoFrame, ExampleSuspenseBoundary, type DemoStore, ThreadList } from '../../components/DemoFrame.tsx'
import type { EnsureClientDocumentSpec } from '../../ensure-client-document.ts'
import { tables } from '../../schema.ts'
import { useEnsureClientDocumentsSuspense } from '../../use-ensure-client-documents-suspense.ts'

const documentId = 'suspense-boundary:inbox'

export const Route = createFileRoute('/client-only/ensure-client-document-suspense-boundary')({
  component: EnsureClientDocumentSuspenseBoundaryPage,
})

function EnsureClientDocumentSuspenseBoundaryPage() {
  return (
    <ExampleSuspenseBoundary>
      <EnsureClientDocumentSuspenseBoundaryContent />
    </ExampleSuspenseBoundary>
  )
}

function EnsureClientDocumentSuspenseBoundaryContent() {
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
      <DemoFrame title="<EnsureClientDocumentSuspenseBoundary>">
        <section className="pattern-note">
          <p>Children do not render until the Suspense boundary has ensured the client document.</p>
        </section>
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
