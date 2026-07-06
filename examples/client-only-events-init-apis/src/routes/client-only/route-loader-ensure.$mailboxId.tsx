import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { ensureThreadListUi } from '../../thread-list-ui/ensure-thread-list-ui.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI row...</div>,
  loader: async ({ context, params, preload }) => {
    // Avoid committing initialization events during TanStack Router link preloads.
    if (preload) return {}

    const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
    const rowId = `loader:${params.mailboxId}`

    ensureThreadListUi(store, {
      id: rowId,
      default: {
        selectedThreadId: null,
        sortBy: 'receivedAt',
        sortDirection: 'desc',
      },
      label: `route-loader:${params.mailboxId}:thread-list-ui`,
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
