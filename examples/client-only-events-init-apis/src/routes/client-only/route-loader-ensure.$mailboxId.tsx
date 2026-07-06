import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { ensureClientOnlyRow } from '../../ensure-client-row/ensure-client-only-row.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { events, tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI row...</div>,
  loader: async ({ context, params, preload }) => {
    // Avoid committing initialization events during TanStack Router link preloads.
    if (preload) return {}

    const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
    const rowId = `loader:${params.mailboxId}`

    ensureClientOnlyRow({
      store,
      table: tables.threadListUi,
      id: rowId,
      defaultValue: {
        selectedThreadId: null,
        sortBy: 'receivedAt',
        sortDirection: 'desc',
      } as const,
      label: `route-loader:${params.mailboxId}:thread-list-ui`,
      event: ({ id, defaultValue }) => events.threadListUiEnsured({ id, ...defaultValue }),
    })

    return { rowId }
  },
  component: RouteLoaderEnsurePage,
})

function RouteLoaderEnsurePage() {
  return <RouteLoaderEnsureContent />
}

function RouteLoaderEnsureContent() {
  const { storeOptions } = Route.useRouteContext()
  const { mailboxId } = Route.useParams()
  const { rowId = `loader:${mailboxId}` } = Route.useLoaderData()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="TanStack Router loader ensure">
      <section className="pattern-note">
        <p>
          The route loader loads the store, then synchronously commits the client-only ensure event before this
          component renders.
        </p>
        <ClientOnlyDataSummary pattern="route loader" rowId={rowId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} rowId={rowId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
