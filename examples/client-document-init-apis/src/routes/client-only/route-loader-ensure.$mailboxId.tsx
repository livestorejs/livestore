import { useStore } from '@livestore/react'
import { createFileRoute } from '@tanstack/react-router'

import { ensureClientDocumentAsync } from '../../client-document/async/ensure-client-document-async.ts'
import { DemoFrame, ThreadList } from '../../components/DemoFrame.tsx'
import { tables } from '../../schema.ts'

export const Route = createFileRoute('/client-only/route-loader-ensure/$mailboxId')({
  pendingComponent: () => <div className="card">Ensuring mailbox UI document…</div>,
  loader: async ({ context, params, preload }) => {
    // Avoid committing initialization events during TanStack Router link preloads.
    if (preload) return {}

    const store = await Promise.resolve(context.storeRegistry.getOrLoadPromise(context.storeOptions))
    const documentId = `loader:${params.mailboxId}`

    await ensureClientDocumentAsync(store, {
      table: tables.threadListUi,
      id: documentId,
      default: ({ store }) => {
        const rows = store.query({
          query: `SELECT * FROM threads WHERE mailboxId = ? ORDER BY receivedAt DESC LIMIT 1`,
          bindValues: [params.mailboxId],
        }) as readonly { id: string }[]

        return {
          selectedThreadId: rows[0]?.id ?? null,
          sortBy: 'receivedAt',
          sortDirection: 'desc',
        } as const
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
          The route loader awaited the example-local <code>ensureClientDocumentAsync(store, spec)</code> before this
          component rendered.
        </p>
      </section>
      <ThreadList store={store} documentId={documentId} mailboxId={mailboxId} />
    </DemoFrame>
  )
}
