import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { useEnsureClientDocument } from '../../client-document/use-ensure-client-document.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'

const documentId = 'hook:support'
const mailboxId = 'support'

export const Route = createFileRoute('/client-only/use-ensure-client-document')({
  component: UseEnsureClientDocumentPage,
})

function UseEnsureClientDocumentPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  useEnsureClientDocument(store, {
    table: tables.threadListUi,
    id: documentId,
    default: { selectedThreadId: 'support-001', sortBy: 'receivedAt', sortDirection: 'desc' },
    label: 'hook:thread-list-ui',
  })

  return (
    <DemoFrame title="useEnsureClientDocument">
      <section className="pattern-note">
        <p>The hook ensures the client document during render, then descendants can read it immediately.</p>
        <ClientOnlyDataSummary pattern="render hook" documentId={documentId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
