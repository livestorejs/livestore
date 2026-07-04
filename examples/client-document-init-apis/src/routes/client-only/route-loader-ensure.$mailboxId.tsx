import { createFileRoute } from '@tanstack/react-router'

import { useStore } from '@livestore/react'

import { ensureClientDocument } from '../../client-document/ensure-client-document.ts'
import { ClientOnlyDataSummary, DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI document…</div>,
  loader: async ({ context, params, preload }) => {
    // Avoid committing initialization events during TanStack Router link preloads.
    if (preload) return {}

    const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
    const documentId = `loader:${params.mailboxId}`

    ensureClientDocument(store, {
      table: tables.threadListUi,
      id: documentId,
      default: {
        selectedThreadId: null,
        sortBy: 'receivedAt',
        sortDirection: 'desc',
      },
      label: `route-loader:${params.mailboxId}:thread-list-ui`,
    })

    return { documentId }
  },
  component: RouteLoaderEnsurePage,
})

function RouteLoaderEnsurePage() {
  return <RouteLoaderEnsureContent />
}

function RouteLoaderEnsureContent() {
  const { storeOptions } = Route.useRouteContext()
  const { mailboxId } = Route.useParams()
  const { documentId = `loader:${mailboxId}` } = Route.useLoaderData()
  const store = useStore(storeOptions)

  return (
    <DemoFrame title="TanStack Router loader ensure">
      <section className="pattern-note">
        <p>
          The route loader loads the store, then synchronously ensures the client document before this component
          renders.
        </p>
        <ClientOnlyDataSummary pattern="route loader" documentId={documentId} mailboxId={mailboxId} />
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
