import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { useEnsureThreadListUi } from '../../client-only-row/use-ensure-thread-list-ui.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'

const rowId = 'hook:support'
const mailboxId = 'support'

export const Route = createFileRoute('/client-only/render-ensure')({
  component: RenderEnsurePage,
})

function RenderEnsurePage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  useEnsureThreadListUi(store, {
    id: rowId,
    default: { selectedThreadId: 'support-004', sortBy: 'receivedAt', sortDirection: 'desc' },
    label: 'hook:thread-list-ui',
  })

  return (
    <DemoFrame title="useEnsureThreadListUi">
      <section className="pattern-note">
        <p>The hook commits an explicit client-only ensure event during render, then descendants read the row.</p>
        <ClientOnlyDataSummary pattern="render hook" rowId={rowId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
