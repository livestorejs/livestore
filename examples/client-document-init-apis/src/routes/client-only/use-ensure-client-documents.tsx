import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'
import { useEnsureClientDocuments } from '../../use-ensure-client-documents.ts'

const documentId = 'sync-hook:inbox'

export const Route = createFileRoute('/client-only/use-ensure-client-documents')({
  component: UseEnsureClientDocumentsPage,
})

function UseEnsureClientDocumentsPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  useEnsureClientDocuments(store, [
    {
      table: tables.threadListUi,
      id: documentId,
      default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
      label: 'sync-hook:thread-list-ui',
    },
  ])

  return (
    <DemoFrame title="useEnsureClientDocuments">
      <section className="pattern-note">
        <p>The sync hook ensures the client document during render, then descendants can read it immediately.</p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
