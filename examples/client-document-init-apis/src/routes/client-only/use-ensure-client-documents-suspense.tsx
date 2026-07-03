import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ExampleSuspenseBoundary, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'
import { useEnsureClientDocumentsSuspense } from '../../use-ensure-client-documents-suspense.ts'

const documentId = 'suspense-hook:inbox'

export const Route = createFileRoute('/client-only/use-ensure-client-documents-suspense')({
  component: UseEnsureClientDocumentsSuspensePage,
})

function UseEnsureClientDocumentsSuspensePage() {
  return (
    <ExampleSuspenseBoundary name="use-ensure-client-documents-suspense">
      <UseEnsureClientDocumentsSuspenseContent />
    </ExampleSuspenseBoundary>
  )
}

function UseEnsureClientDocumentsSuspenseContent() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)
  useEnsureClientDocumentsSuspense(store, [
    {
      table: tables.threadListUi,
      id: documentId,
      default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
      label: 'suspense-hook:thread-list-ui',
    },
  ])

  return (
    <DemoFrame title="useEnsureClientDocumentsSuspense">
      <section className="pattern-note">
        <p>The shared example-local hook suspends before the child thread list reads the client document.</p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
