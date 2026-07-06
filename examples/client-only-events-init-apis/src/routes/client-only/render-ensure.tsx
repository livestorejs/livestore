import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { useEnsureClientOnlyRow } from '../../ensure-client-row/use-ensure-client-only-row.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { events, tables } from '../../schema.ts'

const rowId = 'hook:support'
const mailboxId = 'support'

export const Route = createFileRoute('/client-only/render-ensure')({
  component: RenderEnsurePage,
})

function RenderEnsurePage() {
  const { storeOptions } = Route.useRouteContext()
  const store = useStore(storeOptions)

  useEnsureClientOnlyRow(
    {
      store,
      table: tables.threadListUi,
      id: rowId,
      defaultValue: { selectedThreadId: 'support-004', sortBy: 'receivedAt', sortDirection: 'desc' } as const,
      label: 'hook:thread-list-ui',
      event: ({ id, defaultValue }) => events.threadListUiEnsured({ id, ...defaultValue }),
    },
  )

  return (
    <DemoFrame title="useEnsureClientOnlyRow">
      <section className="pattern-note">
        <p>The hook commits an explicit client-only ensure event during render, then descendants read the row.</p>
        <ClientOnlyDataSummary pattern="render hook" rowId={rowId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
