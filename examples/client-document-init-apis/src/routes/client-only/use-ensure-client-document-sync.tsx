import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { useEnsureClientDocumentSync } from '../../client-document/sync/use-ensure-client-document-sync.ts'
import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'

const documentId = 'sync-hook:inbox'

export const Route = createFileRoute('/client-only/use-ensure-client-document-sync')({
  component: UseEnsureClientDocumentSyncPage,
})

function UseEnsureClientDocumentSyncPage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  useEnsureClientDocumentSync(store, {
    table: tables.threadListUi,
    id: documentId,
    default: { selectedThreadId: null, sortBy: 'receivedAt', sortDirection: 'desc' },
    label: 'sync-hook:thread-list-ui',
  })

  return (
    <DemoFrame title="useEnsureClientDocumentSync">
      <section className="pattern-note">
        <p>The sync hook ensures the client document during render, then descendants can read it immediately.</p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId="inbox" />
    </DemoFrame>
  )
}
