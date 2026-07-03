import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'
import { useClientDocumentsPreflight } from '../../use-client-documents-preflight.ts'

const documentId = 'hook-preflight:inbox'

export const Route = createFileRoute('/client-only/use-client-documents-preflight')({
  component: HookPreflightPage,
})

function HookPreflightPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)
  const ensureResults = useClientDocumentsPreflight(store, [
    {
      table: tables.threadListUi,
      id: documentId,
      default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
      label: 'hook-preflight:thread-list-ui',
    },
  ])

  return (
    <DemoFrame store={store} title="useClientDocumentsPreflight" documentId={documentId} ensureResult={ensureResults}>
      <div className="card">
        <p>The shared example-local hook suspends before the child thread list reads the client document.</p>
      </div>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
